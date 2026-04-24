import { Worker } from "@livekit/agents";
import fetch from "node-fetch";

const worker = new Worker({
  wsUrl: process.env.LIVEKIT_URL,
  apiKey: process.env.LIVEKIT_API_KEY,
  apiSecret: process.env.LIVEKIT_API_SECRET,
});

worker.on("room_started", async (room) => {
  console.log("📞 Agent joined room:", room.name);

  let history = [];

  room.on("track_subscribed", async (track, publication, participant) => {
    if (track.kind !== "audio") return;

    console.log("🎤 User audio detected");

    const audioStream = track;

    // 🔥 Send audio → Deepgram
    const dg = new WebSocket(
      "wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=48000",
      { headers: { Authorization: `Token ${process.env.DEEPGRAM_KEY}` } }
    );

    audioStream.on("data", (chunk) => {
      if (dg.readyState === 1) dg.send(chunk);
    });

    dg.on("message", async (msg) => {
      const data = JSON.parse(msg);
      const transcript = data.channel?.alternatives?.[0]?.transcript;

      if (!transcript || !data.is_final) return;

      console.log("USER:", transcript);

      history.push({ role: "user", content: transcript });

      // 🔥 Claude
      const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": process.env.ANTHROPIC_KEY,
          "content-type": "application/json",
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 70,
          temperature: 0.95,
          system: `PASTE YOUR ORIGINAL PROMPT HERE`,
          messages: history.slice(-6)
        })
      });

      const aiData = await aiRes.json();
      const reply = aiData.content?.[0]?.text || "yeah";

      console.log("AI:", reply);

      history.push({ role: "assistant", content: reply });

      // 🔥 ElevenLabs
      const ttsRes = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${process.env.VOICE_ID}`,
        {
          method: "POST",
          headers: {
            "xi-api-key": process.env.ELEVEN_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            text: reply,
            model_id: "eleven_multilingual_v2",
            optimize_streaming_latency: 3
          })
        }
      );

      const audioBuffer = Buffer.from(await ttsRes.arrayBuffer());

      // 🔥 Send audio back into LiveKit
      room.localParticipant.publishData(audioBuffer);
    });
  });
});

worker.run();
