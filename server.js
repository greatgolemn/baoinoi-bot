// server.js

require('dotenv').config();
const express    = require('express');\const bodyParser = require('body-parser');
const { Firestore, FieldValue } = require('@google-cloud/firestore');
const { OpenAI } = require('openai');
const axios      = require('axios');

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN      = process.env.VERIFY_TOKEN;
const assistantPrompt   = process.env.ASSISTANT_PROMPT; // ใส่ prompt เดิมของคุณใน .env

// Load Firestore credentials from ENV (JSON as string or Base64)
const serviceAccount = process.env.SERVICE_ACCOUNT_KEY;
if (!serviceAccount) {
  console.error('❌ Missing SERVICE_ACCOUNT_KEY environment variable');
  process.exit(1);
}
let credentials;
try {
  // if stored as Base64, decode first
  const raw = /^[A-Za-z0-9+/=]+$/.test(serviceAccount.trim())
    ? Buffer.from(serviceAccount, 'base64').toString('utf8')
    : serviceAccount;
  credentials = JSON.parse(raw);
} catch (err) {
  console.error('❌ Invalid SERVICE_ACCOUNT_KEY JSON:', err);
  process.exit(1);
}
// Initialize Firestore with explicit credentials
const db = new Firestore({
  projectId: credentials.project_id,
  credentials: {
    client_email: credentials.client_email,
    private_key: credentials.private_key.replace(/\\n/g, '\n')
  }
});

// Initialize OpenAI
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Define function for orders
const functions = [
  {
    name: "submit_order",
    description: "บันทึกออเดอร์ลูกค้าลง Firestore",
    parameters: {
      type: "object",
      properties: {
        menu:     { type: "string" },
        type:     { type: "string" },
        quantity: { type: "number" },
        meat:     { type: "string" },
        nickname: { type: "string" },
        phone:    { type: "string" },
        location: { type: "string" },
        date:     { type: "string" },
        time:     { type: "string" },
        note:     { type: "string" }
      },
      required: ["menu","type","quantity","meat","nickname","phone","location","date","time"]
    }
  }
];

const app = express().use(bodyParser.json());

// 1) Webhook verification
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

// 2) Message handler with session/thread management
app.post('/webhook', async (req, res) => {
  try {
    const msg = req.body.entry?.[0]?.messaging?.[0];
    if (!msg || !msg.message?.text) return res.sendStatus(200);

    const psid = msg.sender.id;
    const text = msg.message.text;

    // Session doc for this PSID
    const sessionRef = db.collection('sessions').doc(psid);
    const sessionSnap = await sessionRef.get();
    let threadId = sessionSnap.exists ? sessionSnap.data().threadId : null;

    // Create new thread if none
    if (!threadId) {
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
      await sessionRef.set({ threadId });
    }

    // Append user message to thread
    await openai.beta.threads.messages.create(threadId, {
      role: 'user',
      content: text
    });

    // Run assistant thread
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: process.env.ASSISTANT_ID
    });

    // Wait for completion
    let status;
    do {
      status = await openai.beta.threads.runs.retrieve(threadId, run.id);
      await new Promise(r => setTimeout(r, 1000));
    } while (status.status !== 'completed');

    // Fetch assistant messages
    const messages = await openai.beta.threads.messages.list(threadId);
    const lastMsg = messages.data.slice(-1)[0];
    const replyMsg = lastMsg.content[0].text.value;

    // Handle function call if any
    if (lastMsg.function_call) {
      const order = JSON.parse(lastMsg.function_call.arguments);
      await db.collection('orders').add({ ...order, timestamp: FieldValue.serverTimestamp() });
      // Confirm to user
      await axios.post(
        `https://graph.facebook.com/v15.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
        { recipient: { id: psid }, message: { text: "ขอบคุณครับ พี่สั่งเรียบร้อยแล้วนะครับ 😊" } }
      );
    } else {
      // Normal reply
      await axios.post(
        `https://graph.facebook.com/v15.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
        { recipient: { id: psid }, message: { text: replyMsg } }
      );
    }

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// 3) Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
