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

        try {
            // 调用 AI 获取回复
            const response = await aiClient.chat.completions.create({
                model: "glm-4-flash",
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
    // 处理飞书的 URL 验证（Challenge）
    if (req.body && req.body.type === 'url_verification') {
        return res.status(200).send({
            challenge: req.body.challenge
        });
    }
    // 其他事件交给 SDK 处理
    lark.adaptExpress(eventDispatcher)(req, res, next);
});

// 主动发消息接口
app.post('/api/feishu/push', async (req, res) => {
    const { user_id, text } = req.body;
    
    if (!user_id || !text) {
        return res.status(400).json({ success: false, error: '缺少 user_id 或 text' });
    }

    try {
        const result = await larkClient.im.message.create({
            params: { receive_id_type: 'open_id' },
            data: {
                receive_id: user_id,
                content: JSON.stringify({ text: text }),
                msg_type: 'text',
            },
        });
        res.json({ success: true, msg: '消息发送成功', result });
    } catch (error) {
        console.error('主动发送失败:', error);
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
