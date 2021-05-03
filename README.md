# conference-application
simple conference-application using webrtc

# media server start
```
docker run --rm -p 8888:8888/tcp -p 5000-5050:5000-5050/udp -e KMS_MIN_PORT=5000 -e KMS_MAX_PORT=5050 kurento/kurento-media-server:latest
```

# signaling server start
```
cd conference-application && node server.js
```

```
https://localhost:8443
```
