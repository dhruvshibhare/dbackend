import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:5173",
      "https://dfrontend-eta.vercel.app",
      "https://dfrontend-git-main-dhruvshibhares-projects.vercel.app",
      "https://dfrontend-4q4881jo8-dhruvshibhares-projects.vercel.app"
    ],
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Store waiting users and active rooms
const waitingUsers = new Set();
const activeRooms = new Map();
const userSockets = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Store socket reference
  userSockets.set(socket.id, socket);

  // Handle user looking for a chat
  socket.on('find-stranger', () => {
    console.log('User looking for stranger:', socket.id);
    
    // If there's someone waiting, pair them
    if (waitingUsers.size > 0) {
      const waitingUser = waitingUsers.values().next().value;
      waitingUsers.delete(waitingUser);
      
      // Create room
      const roomId = uuidv4();
      const room = {
        id: roomId,
        users: [socket.id, waitingUser],
        createdAt: new Date()
      };
      
      activeRooms.set(roomId, room);
      
      // Join both users to the room
      socket.join(roomId);
      userSockets.get(waitingUser)?.join(roomId);
      
      // Notify both users
      socket.emit('stranger-found', { roomId, partnerId: waitingUser });
      userSockets.get(waitingUser)?.emit('stranger-found', { roomId, partnerId: socket.id });
      
      console.log(`Paired users ${socket.id} and ${waitingUser} in room ${roomId}`);
    } else {
      // Add to waiting list
      waitingUsers.add(socket.id);
      socket.emit('waiting-for-stranger');
      console.log('Added user to waiting list:', socket.id);
    }
  });

  // Handle WebRTC signaling
  socket.on('webrtc-offer', (data) => {
    socket.to(data.roomId).emit('webrtc-offer', {
      offer: data.offer,
      from: socket.id
    });
  });

  socket.on('webrtc-answer', (data) => {
    socket.to(data.roomId).emit('webrtc-answer', {
      answer: data.answer,
      from: socket.id
    });
  });

  socket.on('webrtc-ice-candidate', (data) => {
    socket.to(data.roomId).emit('webrtc-ice-candidate', {
      candidate: data.candidate,
      from: socket.id
    });
  });

  // Handle chat messages
  socket.on('send-message', (data) => {
    socket.to(data.roomId).emit('receive-message', {
      message: data.message,
      from: socket.id,
      timestamp: new Date()
    });
  });

  // Handle typing indicators
  socket.on('typing-start', (data) => {
    socket.to(data.roomId).emit('user-typing', { from: socket.id });
  });

  socket.on('typing-stop', (data) => {
    socket.to(data.roomId).emit('user-stopped-typing', { from: socket.id });
  });

  // Handle skip/next
  socket.on('skip-user', () => {
    handleUserLeave(socket.id, 'skipped');
    // Immediately look for new stranger
    socket.emit('find-stranger');
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    handleUserLeave(socket.id, 'disconnected');
  });

  function handleUserLeave(userId, reason) {
    // Remove from waiting list
    waitingUsers.delete(userId);
    
    // Find and clean up active room
    for (const [roomId, room] of activeRooms.entries()) {
      if (room.users.includes(userId)) {
        const partnerId = room.users.find(id => id !== userId);
        
        // Notify partner
        if (partnerId && userSockets.has(partnerId)) {
          userSockets.get(partnerId).emit('stranger-disconnected', { reason });
          userSockets.get(partnerId).leave(roomId);
        }
        
        // Clean up room
        activeRooms.delete(roomId);
        console.log(`Cleaned up room ${roomId}, reason: ${reason}`);
        break;
      }
    }
    
    // Clean up socket reference
    userSockets.delete(userId);
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});