"use strict";

let divRoomSelection = document.getElementById("roomSelection");
let divMeetingRoom = document.getElementById("meetingRoom");
let inputName = document.getElementById("name");
let btnRegister = document.getElementById("register");

let controlSection = document.getElementById("controlSection");
let btnUrlCopy = document.getElementById("urlCopy");
let btnCloseCall = document.getElementById("closeCall");




let roomName;
let userName;
let participants = {};

let socket = io();


btnUrlCopy.onclick = function () {
  let dummy = document.createElement("input");
  let text = window.location.href;

  document.body.appendChild(dummy);
  dummy.value = text;
  dummy.select();
  document.execCommand("copy");
  document.body.removeChild(dummy);
  alert("URL이 클립보드에 복사되었습니다");
};

btnCloseCall.onclick = function() {
  let message = {
    event: "closeCall",
    userName: userName,
    roomName: roomName,
  };

  if (confirm("통화를 종료하시겠습니까?")) {
    sendMessage(message);
    closeCall();
    controlSection.style = "display: none";
    divMeetingRoom.style = "display: none";
    alert("감사합니다.");
  }
}


btnRegister.onclick = function () {
  userName = inputName.value;
  if (userName == "") {
    alert("이름은 반드시 입력하셔야 합니다");
  } else {
    const currRoom = window.location.href;
    let message = {
      event: "createRoom",
      roomName: currRoom,
    };

    sendMessage(message);
  }
};

socket.on("message", (message) => {
  switch (message.event) {
    case "roomCreated":
      joinRoom(message.roomPath);
      break;

    case "newParticipantArrived":
      receiveVideo(message.userid, message.username);
      break;

    case "existingParticipants":
      onExistingParticipants(message.userid, message.existingUsers);
      break;

    case "receiveVideoAnswer":
      onReceiveVideoAnswer(message.senderid, message.sdpAnswer);
      break;

    case "candidate":
      addIceCandidate(message.userid, message.candidate);
      break;
    case "closeCall":
      closeCall(message);
      break;
  }
});

function joinRoom(roomPath) {
  roomName = roomPath;

  let message = {
    event: "joinRoom",
    userName: userName,
    roomName: roomName
  };

  sendMessage(message);

  divRoomSelection.style = "display: none";
  divMeetingRoom.style = "display: block";
}

function receiveVideo(userid, username) {
  let video = document.createElement("video");
  let div = document.createElement("div");
  div.className = "videoContainer";
  let name = document.createElement("div");
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
    rtcPeer: null,
    videoContainer: div,
  };

  participants[user.id] = user;

  let options = {
    remoteVideo: video,
    onicecandidate: onIceCandidate,
  };

  user.rtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerRecvonly(
    options,
    function (err) {
      if (err) {
        return console.error(err);
      }
      this.generateOffer(onOffer);
    }
  );

  var onOffer = function (err, offer, wp) {
    console.log("sending offer");
    var message = {
      event: "receiveVideoFrom",
      userid: user.id,
      roomName: roomName,
      sdpOffer: offer,
    };
    sendMessage(message);
  };

  function onIceCandidate(candidate, wp) {
    console.log("sending ice candidates");
    let message = {
      event: "candidate",
      userid: user.id,
      roomName: roomName,
      candidate: candidate,
    };
    sendMessage(message);
  }
}

function onExistingParticipants(userid, existingUsers) {
  let video = document.createElement("video");
  let div = document.createElement("div");
  div.className = "videoContainer";
  let name = document.createElement("div");
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
    videoContainer: div,
  };

  participants[user.id] = user;

  let constraints = {
    audio: true,
    video: {
      mandatory: {
        maxWidth: 540,
        maxFrameRate: 30,
        minFrameRate: 30,
      },
    },
  };

  let options = {
    localVideo: video,
    mediaConstraints: constraints,
    onicecandidate: onIceCandidate,
  };

  user.rtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendonly(
    options,
    function (err) {
      if (err) {
        return console.error(err);
      }
      let check = confirm("상대방에게 화면을 송출하시겠습니까?");
      if (check) {
        this.generateOffer(onOffer);
        controlSection.style = "display: block";
      }
    }
  );

  existingUsers.forEach(function (element) {
    receiveVideo(element.id, element.name);
  });

  let onOffer = function (err, offer, wp) {
    console.log("sending offer");
    let message = {
      event: "receiveVideoFrom",
      userid: user.id,
      roomName: roomName,
      sdpOffer: offer,
    };
    sendMessage(message);
  };

  function onIceCandidate(candidate, wp) {
    console.log("sending ice candidates");
    let message = {
      event: "candidate",
      userid: user.id,
      roomName: roomName,
      candidate: candidate,
    };
    sendMessage(message);
  }
}

function onReceiveVideoAnswer(senderid, sdpAnswer) {
  participants[senderid].rtcPeer.processAnswer(sdpAnswer);
}

function addIceCandidate(userid, candidate) {
  participants[userid].rtcPeer.addIceCandidate(candidate);
}

// utilities
function sendMessage(message) {
  console.log("sending " + message.event + " message to server");
  socket.emit("message", message);
}

function closeCall(message) {
  if (message == null) {
    for (let user in participants) {
      participants[user].rtcPeer.dispose();
      participants[user].rtcPeer = null;
      participants[user].videoContainer.remove();
    }
  } else {
    participants[message.userid].rtcPeer.dispose();
    participants[message.userid].rtcPeer = null;
    participants[message.userid].videoContainer.remove();
  }
}