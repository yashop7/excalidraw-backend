import debug from 'debug';
import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import { Server, Socket } from 'socket.io';
// import * as prometheus from 'socket.io-prometheus-metrics';

const serverDebug = debug('server');

dotenv.config(
  process.env.NODE_ENV === 'development'
      ? { path: '.env.development' }
      : { path: '.env.production' }
);

const app = express();
const port = process.env.PORT || 80; // default port to listen
const users: Socket[] = [];
const userLimit = Number(process.env.USER_LIMIT) || Infinity;

app.get('/', (req, res) => {
    console.log("Healthy Excalidraw backend is up :)");
    res.send('Excalidraw backend is up V3:)');
});

const server = http.createServer(app);

server.listen(port, () => {
    serverDebug(`listening on port: ${port}`);
});

// Create a new Socket.IO v3 server instance with built-in CORS support
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        allowedHeaders: ["Content-Type", "Authorization"],
        credentials: true
    },
    maxHttpBufferSize: 20e6,
    pingTimeout: 60000
});

// // listens on host:9090/metrics
// prometheus.metrics(io, {
//     collectDefaultMetrics: true
// });

io.on('connection', (socket: Socket) => {
    console.log("connection YAY!!");
    serverDebug(`connection established! ${socket.handshake.url}`);
    io.to(socket.id).emit('init-room');

    socket.on('join-room', async (roomID: string) => {
        serverDebug(`${socket.id} has joined ${roomID} for url ${socket.handshake.url}`);
        socket.join(roomID);
        console.log('roomID', roomID);
        console.log("hello hello");
        users.push(socket);

        socket.on('close', () => {
            const index = users.indexOf(socket);
            if (index !== -1) {
                users.splice(index, 1);
            }
        });

        // Get the current room's clients as an array
        const room = io.sockets.adapter.rooms.get(roomID);
        const clients = room ? Array.from(room) : [];

        if (clients.length > userLimit) {
            // If user limit is exceeded, make each client leave the room
            clients.forEach((clientId: string) => {
                const clientSocket = io.sockets.sockets.get(clientId);
                if (clientSocket) {
                    serverDebug(`${clientId} has left the ${roomID} room because the user limit was reached.`);
                    clientSocket.leave(roomID);
                }
            });
            return;
        }

        if (clients.length <= 1) {
            io.to(socket.id).emit('first-in-room');
        } else {
            socket.broadcast.to(roomID).emit('new-user', socket.id);
        }
        io.in(roomID).emit('room-user-change', clients);
    });

    socket.on('server-broadcast', (roomID: string, encryptedData: ArrayBuffer, iv: Uint8Array) => {
        socket.broadcast.to(roomID).emit('client-broadcast', encryptedData, iv);
    });

    socket.on('server-volatile-broadcast', (roomID: string, encryptedData: ArrayBuffer, iv: Uint8Array) => {
        socket.volatile.broadcast.to(roomID).emit('client-broadcast', encryptedData, iv);
    });

    socket.on('disconnecting', () => {
        // Iterate over the rooms the socket is in
        for (const roomID of Array.from(socket.rooms)) {
            if (roomID === socket.id) continue; // Skip the socket's own room
            const room = io.sockets.adapter.rooms.get(roomID);
            const clients = room ? Array.from(room).filter(id => id !== socket.id) : [];
            socket.to(roomID).emit('user has left', socket.id);
            if (clients.length > 0) {
                socket.broadcast.to(roomID).emit('room-user-change', clients);
            }
        }
    });

    socket.on('disconnect', (reason: string) => {
        serverDebug(`${socket.id} was disconnected from url ${socket.handshake.url} for the following reason: ${reason}`);
        socket.removeAllListeners();
    });
});
