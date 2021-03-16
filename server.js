'use strict'
const { v4: uuidv4 } = require('uuid');
const express = require("express");
const app = express();
const fs = require("fs");
const url = require("url");
const path = require('path');

let options = {
  key: fs.readFileSync("keys/server.key"),
  cert: fs.readFileSync("keys/server.crt"),
};

let https = require("https");

let minimist = require("minimist");
let kurento = require("kurento-client");

let urlToken;
let customRooms = {};

let kurentoClient = null;
let iceCandidateQueues = {};

// ws_uri는 반드시 ws:// wss:// 는 안됨 <=== 왜?

let argv = minimist(process.argv.slice(2), {
  default: {
    as_uri: "https://localhost:8443",
    ws_uri: "ws://localhost:8888/kurento"
  },
});

let asUrl = url.parse(argv.as_uri);
let port = asUrl.port;

app.get('/', (req, res) => {
  urlToken = uuidv4();
  res.redirect(`/${urlToken}`);
});


app.get('/:room', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static("public"));

let server = https.createServer(options, app).listen(port, function () {
  console.log("server is starting...!");
  console.log(`open ${url.format(asUrl)} with browser`);
});

let io = require("socket.io")(server);

io.on("connection", (socket) => {
  socket.on("message", (message) => {
    switch (message.event) {
      case 'createRoom':
        createRoomReceive(socket, message.roomName);
        break;
      case 'joinRoom':
        joinRoom(socket, message.userName, message.roomName, (err) => {
          if (err) {
            console.log(err);
          }
        });
        break;
      case 'receiveVideoFrom':
        receiveVideoFrom(socket, message.userid, message.roomName, message.sdpOffer, err => {
          if (err) {
            console.log(err);
          }
        })
        break;
      case 'candidate':
        addIceCandidate(socket, message.userid, message.roomName, message.candidate, err => {
          if (err) {
            console.log(err);
          }
        })
        break;
    }
  });
});

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
  kurento(argv.ws_uri, (err, _kurentoClient) => {
    if (err) {
      console.log(`kurento create error! ${err}`);
      return callback(err);
    }
    kurentoClient = _kurentoClient;
    callback(null, kurentoClient);
  });
}

// socket.io version < 3.x
// io.sockets.adapter.rooms에 존재하는 것은 Object
// socket.io version > 3.x
// io.sockets.adapter.rooms에 존재하는 것은 set
// 따라서 object처럼 뭔가 할 수 없음. 따로 해줘야 함.

function getRoom(socket, roomname, callback) {
  let myRoom = customRooms[roomname] || { length:0 }
  let numClients = myRoom.length;

  if (numClients == 0) {
    socket.join(roomname);
    customRooms[roomname] = {
      length: 1
    };
    getKurentoClient((err, kurentocl) => {
      kurentocl.create("MediaPipeline", (err, pipeline) => {
        customRooms[roomname].pipeline = pipeline;
        customRooms[roomname].participants = {};
        myRoom = customRooms[roomname];
        callback(null, myRoom);
      });
    });
  } else {
    socket.join(roomname);
    myRoom.length += 1;
    callback(null, myRoom);
  }
}

function joinRoom(socket, username, roomname, callback) {
  getRoom(socket, roomname, (err, myRoom) => {
    if (err) {
      return callback(err);
    }
    myRoom.pipeline.create('WebRtcEndpoint', (err, outgoingMedia) => {
      if (err) {
        return callback(err);
      }

      let user = {
        id: socket.id,
        name: username,
        outgoingMedia: outgoingMedia,
        incomingMedia: {},
      }

      let iceCandidateQueue = iceCandidateQueues[user.id];

      if (iceCandidateQueue) {
        while (iceCandidateQueue.length) {
          let ice = iceCandidateQueue.shift();
          user.outgoingMedia.addIceCandidate(ice.candidate);
        }
      }

      user.outgoingMedia.on('OnIceCandidate', (event) => {
        let candidate = kurento.register.complexTypes.IceCandidate(event.candidate);

        socket.emit("message", {
          event: "candidate",
          userid: user.id,
          candidate: candidate
        });
      });

      socket.to(roomname).emit('message', {
        event: "newParticipantArrived",
        userid: user.id,
        username: user.name
      });

      let existingUsers = [];
      for (let i in myRoom.participants) {
        if (myRoom.participants[i].id != user.id) {
          existingUsers.push({
            id: myRoom.participants[i].id,
            name: myRoom.participants[i].name
          });
        }
      }

      socket.emit("message", {
        event: "existingParticipants",
        existingUsers: existingUsers,
        userid: user.id
      });

      myRoom.participants[user.id] = user;

    });
  });
}

function getEndpointForUser(socket, roomname, senderid, callback) {
  let myRoom = customRooms[roomname];
  let asker = myRoom.participants[socket.id];
  let sender = myRoom.participants[senderid];

  console.log(`myroom ${JSON.stringify(myRoom)}`);
  console.log(`asker ${JSON.stringify(asker)}`);
  console.log(`sender ${JSON.stringify(sender)}`);

  if (asker.id === sender.id) {
    return callback(null, asker.outgoingMedia);
  }

  if (asker.incomingMedia[sender.id]) {
    sender.outgoingMedia.connect(asker.incomingMedia[sender.id], err => {
      if (err) {
        return callback(err);
      }
      callback(null, asker.incomingMedia[sender.id]);
    })
  } else {
    myRoom.pipeline.create('WebRtcEndpoint', (err, incoming) => {
      if (err) {
        return callback(err);
      }

      asker.incomingMedia[sender.id] = incoming;

      console.log(`***asker.incomingMedia[sender.id]*** = ${JSON.stringify(asker.incomingMedia[sender.id])}`);
      
      let iceCandidateQueue = iceCandidateQueues[sender.id];
      
      console.log(`***iceCandidateQueue*** ${JSON.stringify(iceCandidateQueue)}`);
      
      if (iceCandidateQueue) {
        while (iceCandidateQueues.length) {
          let ice = iceCandidateQueue.shift();
          incoming.addIceCandidate(ice.candidate);
        }
      }

      incoming.on('OnIceCandidate', event => {
        let candidate = kurento.register.complexTypes.IceCandidate(event.candidate);

        socket.emit('message', {
          event: 'candidate',
          userid: sender.id,
          candidate: candidate,
        })
        sender.outgoingMedia.connect(incoming, err => {
          if (err) {
            return callback(err);
          }
          callback(null, incoming);
        })
      })
    })
  }
}

function receiveVideoFrom(socket, userid, roomName, sdpOffer, callback) {
  getEndpointForUser(socket, roomName, userid, (err, endpoint) => {
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
        sdpAnswer: sdpAnswer
      });

      endpoint.gatherCandidates((err) => {
        if (err) {
          return callback(err);
        }
      });
    });
  });
}

function addIceCandidate(socket, senderid, roomName, iceCandidate, callback) {
  let user = customRooms[roomName].participants[socket.id];

  if (user != null) {
    let candidate = kurento.register.complexTypes.IceCandidate(iceCandidate);

    if (senderid === user.id) {
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

