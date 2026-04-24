import { connect } from "@livekit/rtc-node";

async function run() {
  const room = await connect(
    process.env.LIVEKIT_URL,
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    {
      room: "call-room",
      identity: "agent",
    }
  );

  console.log("Agent joined room");

  // 🔥 THIS is enough to make LiveKit answer the call
}

run();
