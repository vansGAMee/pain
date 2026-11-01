# PAIN listening relay

Independent hosting; there is no central account or music storage. The implementation lives in `desktop/src/listen/relay.js` and the Dockerfile copies it into its image.

```sh
docker build -f relay/Dockerfile -t pain-listen .
docker run --rm --name pain-listen -p 8448:8448 --memory 96m --cpus .5 pain-listen
```

For a public server, put TLS in front of the process, or supply `TLS_CERT` and `TLS_KEY` to Node. The application supports certificate pinning and includes the configured server and pin in the invitation. `PORT` and `BIND` are configurable. `/health` returns counts, never room secrets.

Version 1.9.0 adds host-authorized downloads. Deploy the updated relay code to enable the save button. Download permission starts disabled for every room and belongs to the host even in equal-control rooms. Revocation, source disconnect, removal of the track and room closure terminate affected transfers. No audio is written to the server filesystem. Transfers use Node streams with backpressure; total transfers, downloads, rooms, participants and command rates are bounded. The application checks file length, maximum size and audio duration before adding the completed download to its local library. A client can save one track at a time, up to 512 MiB; the relay accepts at most four simultaneous downloads across its rooms.

These commands create only the PAIN service and require a free application port. This repository change does not deploy anything automatically.
