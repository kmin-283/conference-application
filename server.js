"use strict";
const { v4: uuidv4 } = require("uuid");
const express = require("express");
const app = express();
const fs = require("fs");
const url = require("url");
const path = require("path");

let options = {
  key: fs.readFileSync("keys/server.key"),
  cert: fs.readFileSync("keys/server.crt"),
};

let https = require("https");

let minimist = require("minimist");
let kurento = require("kurento-client");

let conferenceRooms = {};

let kurentoClient = null;
let iceCandidateQueues = {};

let argv = minimist(process.argv.slice(2), {
  default: {
    as_uri: "https://localhost:8443",
    ws_uri: "ws://localhost:8888/kurento",
  },
});

let asUrl = url.parse(argv.as_uri);
let port = asUrl.port;

let server = https.createServer(options, app);

let io = require("socket.io")(server);

app.get("/", (req, res) => {
  let randomUrl = uuidv4();
  res.redirect(`${randomUrl}`);
});

app.get("/:room", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use(express.static("public"));

io.on("connection", (socket) => {
  socket.on("message", (message) => {
    switch (message.event) {
      case "createRoom":
        createRoomReceive(socket, message.roomName);
        break;

      case "joinRoom":
        joinRoom(socket, message.userName, message.roomName, (err) => {
          if (err) {
            console.log(err);
          }
        });
        break;

      case "receiveVideoFrom":
        receiveVideoFrom(
          socket,
          message.userid,
          message.roomName,
          message.sdpOffer,
          (err) => {
            if (err) {
              console.log(err);
            }
          }
        );
        break;

      case "candidate":
        addIceCandidate(
          socket,
          message.userid,
          message.roomName,
          message.candidate,
          (err) => {
            if (err) {
              console.log(err);
            }
          }
        );
        break;
      // case "channel":
      //   channelCreateOrJoin(socket, message.roomName);
      //   break;

      case "channelSdpOffer":
        channelSdpOffer(socket, message.sdpOffer, message.roomName);
        break;

      case "channelSdpAnswer":
        channelSdpAnswer(socket, message.sdpAnswer, message.user);
        break;

      case "channelIceCandidate":
        channelIceCandidate(socket, message.candidate, message.userName);
        break;

      case "closeCall":
        closeCall(socket, message.userName, message.roomName);
        break;
    }
  });
});

let candidatesList = {};

function channelSdpOffer(socket, sdpOffer, roomname) {
  candidatesList[socket.id] = [];
  for (const username in conferenceRooms[roomname].participants) {
    let user = conferenceRooms[roomname].participants[username];
    if (user.id !== socket.id) {
      if (candidatesList[user.id] == null) {
        candidatesList[user.id] = [];
      }
      candidatesList[user.id].push(socket); //요청을 보낸 유저를 요청을 받는 유저에게 추가해둠.
    }
  }

  socket.to(roomname).emit("message", {
    event: "newChannelSdpOffer",
    sdpOffer: sdpOffer,
    user: socket.id,
  });
}

function channelSdpAnswer(socket, sdpAnswer, user) {
  // 답장을 보내는 유저.
  candidatesList[user].push(socket);
  socket.to(user).emit("message", {
    event: "newChannelSdpAnswer",
    sdpAnswer: sdpAnswer,
  });
}

function channelIceCandidate(socket, candidate) {
  if (candidatesList[socket.id]) {
    candidatesList[socket.id].forEach((remoteClient) => {
      remoteClient.emit("message", {
        event: "newChannelIceCandidate",
        candidate: candidate,
      });
    });
    candidatesList[socket.id] = [];
  }
}

// function channelCreateOrJoin(socket, roomname) {
//   const myRoom = conferenceRooms[roomname];

//   if (myRoom && myRoom.channel == null) {
//     myRoom.channel = true;
//     socket.emit("message", {
//       event: "createOrJoinChannel",
//       type: "create",
//     });
//   } else if (myRoom) {
//     socket.emit("message", {
//       event: "createOrJoinChannel",
//       type: "join",
//     });
//   }
// }

function createRoomReceive(socket, roomName) {
  const roomPath = url.parse(roomName).path;

  socket.emit("message", {
    event: "roomCreated",
    roomPath: roomPath,
  });
}

function getKurentoClient(callback) {
  if (kurentoClient !== null) {
    return callback(null, kurentoClient);
  }

  kurento(argv.ws_uri, function (error, _kurentoClient) {
    if (error) {
      console.log(`Could not find media server at address ${argv.ws_uri}`);
      return callback(`Could not find media server at address ${argv.ws_uri}\n
                Exiting with error ${error}`);
    }

    kurentoClient = _kurentoClient;
    callback(null, kurentoClient);
  });
}

function getRoom(socket, roomname, callback) {
  let myRoom = conferenceRooms[roomname] || { length: 0 };
  let numClients = myRoom.length;

  console.log(`now ${roomname} has ${numClients} clients`);

  if (numClients == 0) {
    socket.join(roomname);
    conferenceRooms[roomname] = {
      length: 1,
    };
    getKurentoClient((error, kurento) => {
      kurento.create("MediaPipeline", (err, pipeline) => {
        if (err) {
          return callback(err);
        }
        conferenceRooms[roomname].pipeline = pipeline;
        conferenceRooms[roomname].participants = {};
        myRoom = conferenceRooms[roomname];
        callback(null, myRoom);
      });
    });
  } else {
    socket.join(roomname);
    myRoom.length++;
    callback(null, myRoom);
  }
}

function joinRoom(socket, username, roomname, callback) {
  getRoom(socket, roomname, (err, myRoom) => {
    if (err) {
      myRoom.pipeline.release();
      return callback(err);
    }

    myRoom.pipeline.create("WebRtcEndpoint", (err, outgoingMedia) => {
      if (err) {
        myRoom.pipeline.release();
        return callback(err);
      }

      let user = {
        id: socket.id,
        name: username,
        outgoingMedia: outgoingMedia,
        incomingMedia: {},
      };

      let iceCandidateQueue = iceCandidateQueues[user.id];
      if (iceCandidateQueue) {
        while (iceCandidateQueue.length) {
          let ice = iceCandidateQueue.shift();
          console.error(
            `user: ${user.name} collect candidate for outgoing media`
          );
          user.outgoingMedia.addIceCandidate(ice.candidate);
        }
      }

      user.outgoingMedia.on("OnIceCandidate", (event) => {
        let candidate = kurento.getComplexType("IceCandidate")(event.candidate);
        socket.emit("message", {
          event: "candidate",
          userid: user.id,
          candidate: candidate,
        });
      });

      socket.to(roomname).emit("message", {
        event: "newParticipantArrived",
        userid: user.id,
        username: user.name,
      });

      let existingUsers = [];
      for (let i in myRoom.participants) {
        if (myRoom.participants[i].id != user.id) {
          existingUsers.push({
            id: myRoom.participants[i].id,
            name: myRoom.participants[i].name,
          });
        }
      }
      socket.emit("message", {
        event: "existingParticipants",
        userid: user.id,
        numberOfClients: myRoom.length,
        existingUsers: existingUsers,
      });

      myRoom.participants[user.id] = user;
    });
  });
}

function receiveVideoFrom(socket, userid, roomname, sdpOffer, callback) {
  getEndpointForUser(socket, roomname, userid, (err, endpoint) => {
    if (err) {
      return callback(err);
    }
    endpoint.processOffer(sdpOffer, (err, sdpAnswer) => {
      if (err) {
        return callback(err);
      }

      socket.emit("message", {
        event: "receiveVideoAnswer",
        senderid: userid,
        sdpAnswer: sdpAnswer,
      });

      endpoint.gatherCandidates((err) => {
        if (err) {
          return callback(err);
        }
      });
    });
  });
}

function getEndpointForUser(socket, roomname, senderid, callback) {
  let myRoom = conferenceRooms[roomname];
  let asker = myRoom.participants[socket.id];
  let sender = myRoom.participants[senderid];

  if (asker.id === sender.id) {
    return callback(null, asker.outgoingMedia);
  }

  if (asker.incomingMedia[sender.id]) {
    sender.outgoingMedia.connect(asker.incomingMedia[sender.id], (err) => {
      if (err) {
        myRoom.pipeline.release();
        return callback(err);
      }
      callback(null, asker.incomingMedia[sender.id]);
    });
  } else {
    myRoom.pipeline.create("WebRtcEndpoint", (err, incoming) => {
      if (err) {
        myRoom.pipeline.release();
        return callback(err);
      }

      asker.incomingMedia[sender.id] = incoming;

      let iceCandidateQueue = iceCandidateQueues[sender.id];
      if (iceCandidateQueue) {
        while (iceCandidateQueue.length) {
          let ice = iceCandidateQueue.shift();
          console.error(
            `user: ${sender.name} collect candidate for outgoing media`
          );
          incoming.addIceCandidate(ice.candidate);
        }
      }

      incoming.on("OnIceCandidate", (event) => {
        let candidate = kurento.getComplexType("IceCandidate")(event.candidate);

        socket.emit("message", {
          event: "candidate",
          userid: sender.id,
          candidate: candidate,
        });
      });

      sender.outgoingMedia.connect(incoming, (err) => {
        if (err) {
          myRoom.pipeline.release();
          return callback(err);
        }
        callback(null, incoming);
      });
    });
  }
}

function addIceCandidate(socket, senderid, roomname, iceCandidate, callback) {
  let user = conferenceRooms[roomname].participants[socket.id];
  if (user != null) {
    let candidate = kurento.getComplexType("IceCandidate")(iceCandidate);

    if (senderid == user.id) {
      if (user.outgoingMedia) {
        user.outgoingMedia.addIceCandidate(candidate);
      } else {
        iceCandidateQueues[user.id].push({ candidate: candidate });
      }
    } else {
      if (user.incomingMedia[senderid]) {
        user.incomingMedia[senderid].addIceCandidate(candidate);
      } else {
        if (!iceCandidateQueues[senderid]) {
          iceCandidateQueues[senderid] = [];
        }
        iceCandidateQueues[senderid].push({ candidate: candidate });
      }
    }
    callback(null);
  } else {
    callback(new Error("addIceCandidate failed"));
  }
}

function closeCall(socket, username, roomname) {
  let room = conferenceRooms[roomname];
  delete room.participants[socket.id];
  socket.leave(roomname);

  let message = {
    event: "closeCall",
    userid: socket.id,
  };

  socket.to(roomname).emit("message", message);
}

server.listen(port, function () {
  console.log(`server starting ${argv.as_uri}`);
});
