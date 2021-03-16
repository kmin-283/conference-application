'use strict'
let divRoomSelection = document.getElementById('roomSelection');

let divMeetingRoom = document.getElementById('meetingRoom');
let btnRegister = document.getElementById('register');
let inputName = document.getElementById('name');

//variables
let roomName;
let userName;
let participants = {};

const socket = io();

btnRegister.onclick = function() {
  userName = inputName.value;
  if (userName == "") {
    alert("이름은 반드시 입력하셔야 합니다");
  } else {
    const currRoom = window.location.href;
    let message = {
      event: "createRoom",
      roomName: currRoom
    };
    sendMessage(message);
  }
}

socket.on('message', message => {
  switch (message.event) {
    case 'roomCreated':
      joinRoom(message.roomPath);
      break;
    case 'newParticipantArrived':
      console.log(message);
      receiveVideo(message.userid, message.username);
      break;
    case 'existingParticipants':
      console.log(message);
      onExistingParticipants(message.userid, message.existingUsers);
      break;
    case 'receiveVideoAnswer':
      console.log(message);
      onReceiveVideoAnswer(message.senderid, message.sdpAnswer);
      break;
    case 'candidate':
      addIceCandidate(message.userid, message.candidate);
      break;
  }
})

function joinRoom(roomPath) {
  roomName = roomPath;

  let message = {
    event: 'joinRoom',
    userName: userName,
    roomName: roomName
  };

  sendMessage(message);

  divRoomSelection.style = "display: none";
  divMeetingRoom.style = "display: block";
}

function sendMessage(message) {
  socket.emit('message', message);
}

function receiveVideo(userid, username) {
  let video = document.createElement('video');
  let div = document.createElement('div');
  div.className = 'videoContainer';
  let name = document.createElement('div');
  video.id = userid;
  video.autoplay = true;
  name.appendChild(document.createTextNode(username));
  div.appendChild(video);
  div.appendChild(name);
  divMeetingRoom.appendChild(div);

  let user = {
    id: userid,
    username: username,
    video: video,
    rtcPeer: null
  };

  participants[user.id] = user;

  let options = {
    remoteVideo: video,
    onicecandidate: onIceCandidate
  };

  user.rtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerRecvonly(options, function(err) {
    if (err) {
      return console.error(err)
    }
    this.generateOffer(function(err, offer, wp) {
      if (err) {
        return console.error(err);
      }

      let message = {
        event: "receiveVideoFrom",
        userid: user.id,
        roomName: roomName,
        sdpOffer: offer,
      };
      sendMessage(message);
    });
  });

  function onIceCandidate(candidate, wp) {
    let message = {
      event: 'candidate',
      userid: user.id,
      roomName: roomName,
      candidate: candidate
    }
    sendMessage(message);
  }
}

function onExistingParticipants(userid, existingUsers) {
  let video = document.createElement('video');
  let div = document.createElement('div');
  div.className = 'videoContainer';
  let name = document.createElement('div');
  video.id = userid;
  video.autoplay = true;
  name.appendChild(document.createTextNode(userName));
  div.appendChild(video);
  div.appendChild(name);
  divMeetingRoom.appendChild(div);

  let user = {
    id: userid,
    username: userName,
    video: video,
    rtcPeer: null,
  };

  participants[user.id] = user;

  let constraints = {
    audio: true,
    video: {
      mandatory: {
        maxWidth: 320,
        maxFrameRate: 30,
        minFrameRate: 30,
      }
    }
  }

  let options = {
    localVideo: video,
    onicecandidate: onIceCandidate,
    mediaConstraints: constraints,
  };

  user.rtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendonly(options, function(err) {
    if (err) {
      return console.error(err);
    }
    this.generateOffer(function (err, offer, wp) {
      if (err) {
        return console.error(err);
      }

      let message = {
        event: "receiveVideoFrom",
        userid: user.id,
        roomName: roomName,
        sdpOffer: offer,
      };
      sendMessage(message);
    });
  });

  existingUsers.forEach((element) => {
    receiveVideo(element.id, element.name);
  });

  function onIceCandidate(candidate, wp) {
    let message = {
      event: 'candidate',
      userid: user.id,
      roomName: roomName,
      candidate: candidate
    }
    sendMessage(message);
  }
}

function onReceiveVideoAnswer(senderid, sdpAnswer) {
  participants[senderid].rtcPeer.processAnswer(sdpAnswer);
}

function addIceCandidate(userid, candidate) {
  participants[userid].rtcPeer.addIceCandidate(candidate);
}