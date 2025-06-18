// server.js

require('dotenv').config();
const express    = require('express');
const bodyParser = require('body-parser');
const { Firestore, FieldValue } = require('@google-cloud/firestore');
const { OpenAI } = require('openai');
const axios      = require('axios');

const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const VERIFY_TOKEN      = process.env.VERIFY_TOKEN;
const assistantPrompt   = process.env.ASSISTANT_PROMPT; // ใส่ prompt เดิมของคุณใน .env
const db                = new Firestore();
const openai            = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

// 2) Webhook event handler
app.post('/webhook', async (req, res) => {
  try {
    const messaging = req.body.entry?.[0]?.messaging?.[0];
    if (!messaging || !messaging.message?.text) return res.sendStatus(200);

    const psid = messaging.sender.id;
    const text = messaging.message.text;

    // build messages array reusing your existing prompt
    const messages = [
      { role: "system", content: assistantPrompt },
      { role: "user",   content: text }
    ];

    // 3) call OpenAI with function support
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      functions,
      function_call: "auto"
    });

    const reply = completion.choices[0].message;

    if (reply.function_call) {
      // 4) parse and save order
      const order = JSON.parse(reply.function_call.arguments);
      await db.collection('orders').add({
        ...order,
        timestamp: FieldValue.serverTimestamp()
      });

      // 5) confirm to user
      await axios.post(
        `https://graph.facebook.com/v15.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
        {
          recipient: { id: psid },
          message:   { text: "ขอบคุณครับ พี่สั่งเรียบร้อยแล้วนะครับ 😊" }
        }
      );
    } else {
      // 6) Q&A fallback
      await axios.post(
        `https://graph.facebook.com/v15.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`,
        {
          recipient: { id: psid },
          message:   { text: reply.content }
        }
      );
    }

    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.sendStatus(500);
  }
});

// 7) start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server is running on port ${PORT}`));
