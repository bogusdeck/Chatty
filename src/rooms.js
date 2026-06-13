class RoomStore {
  constructor() {
    this.rooms = new Map();
  }

  ensureRoom(roomId) {
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, {
        host: null,
        participants: new Map()
      });
    }

    return this.rooms.get(roomId);
  }

  join(roomId, socketId, username) {
    const room = this.ensureRoom(roomId);

    if (room.participants.size >= 2) {
      return { ok: false, reason: "Room is full." };
    }

    if ([...room.participants.values()].some((participant) => participant.username === username)) {
      return { ok: false, reason: "User is already connected in this room." };
    }

    const isHost = room.participants.size === 0;
    room.participants.set(socketId, { username, isHost });

    if (isHost) {
      room.host = socketId;
    }

    return {
      ok: true,
      isHost,
      participants: this.list(roomId)
    };
  }

  leave(roomId, socketId) {
    const room = this.rooms.get(roomId);

    if (!room || !room.participants.has(socketId)) {
      return null;
    }

    const participant = room.participants.get(socketId);
    room.participants.delete(socketId);

    const wasHost = room.host === socketId;
    if (wasHost) {
      room.host = null;
    }

    if (room.participants.size === 0) {
      this.rooms.delete(roomId);
    }

    return {
      participant,
      wasHost,
      remainingParticipants: this.list(roomId)
    };
  }

  list(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return [];
    }

    return [...room.participants.entries()].map(([socketId, participant]) => ({
      socketId,
      username: participant.username,
      isHost: participant.isHost
    }));
  }

  exists(roomId) {
    return this.rooms.has(roomId);
  }
}

module.exports = RoomStore;
