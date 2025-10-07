require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Storage em memória
const tokens = new Map();

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session config
app.use(session({
    secret: process.env.SESSION_SECRET || 'chave-muito-secreta-para-sessao-123456789',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        maxAge: 30 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax'
    }
}));

app.use(express.static(path.join(__dirname, 'public')));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware de log
app.use((req, res, next) => {
    console.log('🔍', req.method, req.path, '| User:', req.session.user?.username || 'N/A');
    next();
});

// Middleware para APIs
const requireAuthAPI = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Não autenticado' });
    }
    next();
};

// ========== ROTAS ========== //

// Rota principal
app.get('/', (req, res) => {
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Login Discord
app.get('/auth/discord', (req, res) => {
    console.log('🔐 Iniciando login Discord...');
    
    const discordAuthURL = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=https%3A%2F%2Fcl-efk0.onrender.com%2Fauth%2Fdiscord%2Fcallback&response_type=code&scope=identify`;
    
    res.redirect(discordAuthURL);
});

// Callback do Discord
app.get('/auth/discord/callback', async (req, res) => {
    try {
        const { code } = req.query;
        
        console.log('🔄 Callback recebido, code:', code ? '✅' : '❌');
        
        if (!code) {
            return res.redirect('/?error=no_code');
        }

        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token',
            new URLSearchParams({
                client_id: process.env.DISCORD_CLIENT_ID,
                client_secret: process.env.DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: 'https://cl-efk0.onrender.com/auth/discord/callback',
                scope: 'identify'
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        const accessToken = tokenResponse.data.access_token;

        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        });

        const userData = userResponse.data;
        
        req.session.user = {
            id: userData.id,
            username: userData.username,
            discriminator: userData.discriminator,
            avatar: userData.avatar
        };

        req.session.save((err) => {
            if (err) {
                return res.redirect('/?error=session_error');
            }
            res.redirect('/dashboard');
        });

    } catch (error) {
        console.error('❌ Erro no callback:', error.response?.data || error.message);
        res.redirect('/?error=auth_failed');
    }
});

// Dashboard
app.get('/dashboard', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/');
    }

    const userToken = tokens.get(req.session.user.id);

    res.render('dashboard', {
        user: req.session.user,
        token: userToken || null
    });
});

// Salvar Token
app.post('/save-token', requireAuthAPI, (req, res) => {
    const { token } = req.body;
    
    if (!token) {
        return res.status(400).json({ error: 'Token é obrigatório' });
    }

    tokens.set(req.session.user.id, token);
    
    res.json({ 
        success: true, 
        message: 'Token salvo com sucesso!' 
    });
});

// Limpar DM
app.post('/clear-dm', requireAuthAPI, async (req, res) => {
    const { channelId } = req.body;
    const userToken = tokens.get(req.session.user.id);

    if (!channelId) {
        return res.status(400).json({ error: 'Channel ID é obrigatório' });
    }

    if (!userToken) {
        return res.status(400).json({ error: 'Token não configurado' });
    }

    try {
        const response = await axios.get(`https://discord.com/api/v9/channels/${channelId}/messages`, {
            headers: {
                'Authorization': userToken
            }
        });

        const messages = response.data;
        let deletedCount = 0;

        for (const message of messages) {
            if (message.author.id === req.session.user.id) {
                try {
                    await axios.delete(`https://discord.com/api/v9/channels/${channelId}/messages/${message.id}`, {
                        headers: {
                            'Authorization': userToken
                        }
                    });
                    deletedCount++;
                    
                    await new Promise(resolve => 
                        setTimeout(resolve, Math.random() * 1600 + 400)
                    );
                } catch (error) {
                    console.error('Erro ao deletar mensagem:', error.message);
                }
            }
        }
        
        res.json({ 
            success: true, 
            message: `Limpeza concluída! ${deletedCount} mensagens deletadas.` 
        });

    } catch (error) {
        console.error('Erro ao limpar DM:', error.message);
        res.status(500).json({ 
            error: 'Erro ao limpar DM. Verifique o token e o channel ID.' 
        });
    }
});

// Limpar Mensagens em Servidor
app.post('/clear-server-messages', requireAuthAPI, async (req, res) => {
    const { channelId } = req.body;
    const userToken = tokens.get(req.session.user.id);

    if (!channelId) {
        return res.status(400).json({ error: 'Channel ID é obrigatório' });
    }

    if (!userToken) {
        return res.status(400).json({ error: 'Token não configurado' });
    }

    try {
        const response = await axios.get(`https://discord.com/api/v9/channels/${channelId}/messages`, {
            headers: {
                'Authorization': userToken
            }
        });

        const messages = response.data;
        let deletedCount = 0;

        for (const message of messages) {
            if (message.author.id === req.session.user.id) {
                try {
                    await axios.delete(`https://discord.com/api/v9/channels/${channelId}/messages/${message.id}`, {
                        headers: {
                            'Authorization': userToken
                        }
                    });
                    deletedCount++;
                    
                    await new Promise(resolve => 
                        setTimeout(resolve, Math.random() * 1600 + 400)
                    );
                } catch (error) {
                    console.error('Erro ao deletar mensagem:', error.message);
                }
            }
        }
        
        res.json({ 
            success: true, 
            message: `Limpeza concluída! ${deletedCount} mensagens deletadas do servidor.` 
        });

    } catch (error) {
        console.error('Erro ao limpar mensagens do servidor:', error.message);
        res.status(500).json({ 
            error: 'Erro ao limpar mensagens. Verifique os IDs e permissões.' 
        });
    }
});

// Sair de Todos os Servidores
app.post('/leave-all-servers', requireAuthAPI, async (req, res) => {
    const userToken = tokens.get(req.session.user.id);

    if (!userToken) {
        return res.status(400).json({ error: 'Token não configurado' });
    }

    try {
        const response = await axios.get('https://discord.com/api/v9/users/@me/guilds', {
            headers: {
                'Authorization': userToken
            }
        });

        const servers = response.data;
        let leftCount = 0;

        for (const server of servers) {
            try {
                await axios.delete(`https://discord.com/api/v9/users/@me/guilds/${server.id}`, {
                    headers: {
                        'Authorization': userToken
                    }
                });
                leftCount++;
                
                await new Promise(resolve => 
                    setTimeout(resolve, Math.random() * 1600 + 400)
                );
            } catch (error) {
                console.error(`Erro ao sair do servidor ${server.name}:`, error.message);
            }
        }
        
        res.json({ 
            success: true, 
            message: `Saída concluída! Você saiu de ${leftCount} servidores.` 
        });

    } catch (error) {
        console.error('Erro ao sair dos servidores:', error.message);
        res.status(500).json({ 
            error: 'Erro ao sair dos servidores. Verifique o token.' 
        });
    }
});

// Sair de Todas as DMs em Grupo
app.post('/leave-group-dms', requireAuthAPI, async (req, res) => {
    const userToken = tokens.get(req.session.user.id);

    if (!userToken) {
        return res.status(400).json({ error: 'Token não configurado' });
    }

    try {
        const response = await axios.get('https://discord.com/api/v9/users/@me/channels', {
            headers: {
                'Authorization': userToken
            }
        });

        const channels = response.data;
        let leftCount = 0;

        for (const channel of channels) {
            if (channel.type === 3 && channel.recipients && channel.recipients.length <= 10) {
                try {
                    await axios.delete(`https://discord.com/api/v9/channels/${channel.id}`, {
                        headers: {
                            'Authorization': userToken
                        }
                    });
                    leftCount++;
                    
                    await new Promise(resolve => 
                        setTimeout(resolve, Math.random() * 1600 + 400)
                    );
                } catch (error) {
                    console.error(`Erro ao sair do grupo ${channel.id}:`, error.message);
                }
            }
        }
        
        res.json({ 
            success: true, 
            message: `Saída concluída! Você saiu de ${leftCount} grupos DM.` 
        });

    } catch (error) {
        console.error('Erro ao sair dos grupos DM:', error.message);
        res.status(500).json({ 
            error: 'Erro ao sair dos grupos DM. Verifique o token.' 
        });
    }
});

// 🆕 TRIGGER - Limpar TODAS as mensagens em TODOS os lugares
app.post('/trigger-cleanup', requireAuthAPI, async (req, res) => {
    const userToken = tokens.get(req.session.user.id);

    if (!userToken) {
        return res.status(400).json({ error: 'Token não configurado' });
    }

    try {
        let totalDeleted = 0;
        
        // 1. Limpar mensagens em servidores
        const guildsResponse = await axios.get('https://discord.com/api/v9/users/@me/guilds', {
            headers: { 'Authorization': userToken }
        });

        for (const guild of guildsResponse.data) {
            try {
                const channelsResponse = await axios.get(`https://discord.com/api/v9/guilds/${guild.id}/channels`, {
                    headers: { 'Authorization': userToken }
                });

                for (const channel of channelsResponse.data) {
                    if (channel.type === 0) {
                        try {
                            const messagesResponse = await axios.get(`https://discord.com/api/v9/channels/${channel.id}/messages?limit=100`, {
                                headers: { 'Authorization': userToken }
                            });

                            for (const message of messagesResponse.data) {
                                if (message.author.id === req.session.user.id) {
                                    await axios.delete(`https://discord.com/api/v9/channels/${channel.id}/messages/${message.id}`, {
                                        headers: { 'Authorization': userToken }
                                    });
                                    totalDeleted++;
                                    await new Promise(resolve => setTimeout(resolve, Math.random() * 1600 + 400));
                                }
                            }
                        } catch (error) {
                            console.error(`Erro no canal ${channel.id}:`, error.message);
                        }
                    }
                }
            } catch (error) {
                console.error(`Erro no servidor ${guild.name}:`, error.message);
            }
        }

        // 2. Limpar mensagens em DMs e grupos
        const dmsResponse = await axios.get('https://discord.com/api/v9/users/@me/channels', {
            headers: { 'Authorization': userToken }
        });

        for (const dm of dmsResponse.data) {
            try {
                const messagesResponse = await axios.get(`https://discord.com/api/v9/channels/${dm.id}/messages?limit=100`, {
                    headers: { 'Authorization': userToken }
                });

                for (const message of messagesResponse.data) {
                    if (message.author.id === req.session.user.id) {
                        await axios.delete(`https://discord.com/api/v9/channels/${dm.id}/messages/${message.id}`, {
                            headers: { 'Authorization': userToken }
                        });
                        totalDeleted++;
                        await new Promise(resolve => setTimeout(resolve, Math.random() * 1600 + 400));
                    }
                }
            } catch (error) {
                console.error(`Erro na DM ${dm.id}:`, error.message);
            }
        }

        res.json({ 
            success: true, 
            message: `TRIGGER concluído! ${totalDeleted} mensagens deletadas de todos os lugares.` 
        });

    } catch (error) {
        console.error('Erro no TRIGGER:', error.message);
        res.status(500).json({ 
            error: 'Erro no TRIGGER. Verifique o token.' 
        });
    }
});

// 🆕 Limpar TODAS as DMs (conversas e grupos)
app.post('/clear-all-dms', requireAuthAPI, async (req, res) => {
    const userToken = tokens.get(req.session.user.id);

    if (!userToken) {
        return res.status(400).json({ error: 'Token não configurado' });
    }

    try {
        let deletedCount = 0;
        
        const dmsResponse = await axios.get('https://discord.com/api/v9/users/@me/channels', {
            headers: { 'Authorization': userToken }
        });

        for (const dm of dmsResponse.data) {
            try {
                const messagesResponse = await axios.get(`https://discord.com/api/v9/channels/${dm.id}/messages?limit=100`, {
                    headers: { 'Authorization': userToken }
                });

                for (const message of messagesResponse.data) {
                    if (message.author.id === req.session.user.id) {
                        await axios.delete(`https://discord.com/api/v9/channels/${dm.id}/messages/${message.id}`, {
                            headers: { 'Authorization': userToken }
                        });
                        deletedCount++;
                        await new Promise(resolve => setTimeout(resolve, Math.random() * 1600 + 400));
                    }
                }
            } catch (error) {
                console.error(`Erro na DM ${dm.id}:`, error.message);
            }
        }

        res.json({ 
            success: true, 
            message: `Limpeza concluída! ${deletedCount} mensagens deletadas de todas as DMs.` 
        });

    } catch (error) {
        console.error('Erro ao limpar todas as DMs:', error.message);
        res.status(500).json({ 
            error: 'Erro ao limpar DMs. Verifique o token.' 
        });
    }
});

// Logout
app.get('/logout', (req, res) => {
    if (req.session.user) {
        tokens.delete(req.session.user.id);
    }
    
    req.session.destroy((err) => {
        res.redirect('/');
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK',
        user: req.session.user ? req.session.user.username : 'Não logado'
    });
});

// Debug session
app.get('/debug-session', (req, res) => {
    res.json({
        user: req.session.user,
        sessionID: req.sessionID,
        hasToken: req.session.user ? tokens.has(req.session.user.id) : false
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
