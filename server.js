const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const OpenAI = require('openai');
const lark = require('@larksuiteoapi/node-sdk');

dotenv.config();

const app = express();
app.use(cors());

// 飞书 SDK 客户端初始化
const larkClient = new lark.Client({
    appId: process.env.FEISHU_APP_ID,
    appSecret: process.env.FEISHU_APP_SECRET,
});

// Zhipu AI 客户端
const aiClient = new OpenAI({
    apiKey: process.env.ZHIPU_API_KEY,
    baseURL: "https://open.bigmodel.cn/api/paas/v4/"
});

// 解析 JSON
app.use(express.json());
// 飞书 Webhook 需要处理特定格式，如果是处理事件，通常建议使用 SDK 提供的 Dispatcher
const eventDispatcher = new lark.EventDispatcher({
    verificationToken: process.env.FEISHU_VERIFICATION_TOKEN,
}).register({
    'im.message.receive_v1': async (data) => {
        const { message } = data;
        const text = JSON.parse(message.content).text;
        const openId = message.mentions ? message.mentions[0].id : data.sender.sender_id.open_id;

        console.log(`收到来自飞书的消息: ${text}`);

        try {
            // 调用 AI 获取回复
            const response = await aiClient.chat.completions.create({
                model: "glm-4.7-flash",
                messages: [{ role: "user", content: text }],
            });
            const aiReply = response.choices[0].message.content;

            // 回复飞书消息
            await larkClient.im.message.reply({
                path: { message_id: message.message_id },
                data: {
                    content: JSON.stringify({ text: aiReply }),
                    msg_type: 'text',
                },
            });
        } catch (error) {
            console.error('飞书回复失败:', error);
        }
    },
});

// 飞书事件订阅 Webhook 接口
app.post('/api/feishu/webhook', (req, res, next) => {
    console.log('收到 Webhook 请求:', JSON.stringify(req.body));
    
    // 特别处理飞书的 URL 验证（Challenge）
    if (req.body.type === 'url_verification') {
        console.log('正在响应飞书 URL 验证...');
        return res.json({
            challenge: req.body.challenge
        });
    }
    // 其他事件交给 SDK 处理
    lark.adaptExpress(eventDispatcher)(req, res, next);
});

// 主动发消息接口 (示例)
app.post('/api/feishu/send', async (req, res) => {
    const { receive_id, text } = req.body; // receive_id 可以是 open_id
    try {
        const result = await larkClient.im.message.create({
            params: { receive_id_type: 'open_id' },
            data: {
                receive_id: receive_id,
                content: JSON.stringify({ text: text }),
                msg_type: 'text',
            },
        });
        res.json({ success: true, result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.use(express.static('public'));

app.post('/api/chat', async (req, res) => {
    const { messages } = req.body;
    try {
        const response = await aiClient.chat.completions.create({
            model: "glm-4-flash",
            messages: messages,
        });
        res.json(response.choices[0].message);
    } catch (error) {
        console.error('Error with Zhipu AI:', error);
        res.status(500).json({ error: 'Failed to fetch response from AI' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
