// runOrder.js

require('dotenv').config();
const { Firestore, FieldValue } = require('@google-cloud/firestore');
const { OpenAI } = require('openai');

const db = new Firestore();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

async function runOrder() {
  const resp = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "คุณคือแชทบอทขายไส้อั่ว ถ้าผู้ใช้สั่งสินค้า ให้เรียก submit_order พร้อมข้อมูล" },
      { role: "user", content: "ผมอยากสั่งไส้อั่วย่าง 1 กิโล สูตรเผ็ดน้อย ส่งเชียงใหม่พรุ่งนี้เช้า" }
    ],
    functions,
    function_call: { name: "submit_order" }
  });

  const msg = resp.choices[0].message;
  if (!msg.function_call) return console.log("❌ GPT ยังไม่เรียก function");

  const order = JSON.parse(msg.function_call.arguments);
  const doc = await db.collection('orders').add({
    ...order,
    timestamp: FieldValue.serverTimestamp()
  });
  console.log("✅ บันทึกลง Firestore, ID:", doc.id);
}

runOrder();
