require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Storage em memória
const tokens = new Map();

// Middlewares CRÍTICOS - ORDEM IMPORTA
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session config - CONFIGURAÇÃO QUE FUNCIONA
app.use(session({
    secret: process.env.SESSION_SECRET || 'chave-muito-secreta-para-sessao-123456789',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // IMPORTANTE: false para desenvolvimento
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 dias
        httpOnly: true,
        sameSite: 'lax'
    }
}));

// Servir arquivos estáticos DEPOIS da sessão
app.use(express.static(path.join(__dirname, 'public')));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware de log para debug
app.use((req, res, next) => {
    console.log('🔍', req.method, req.path, '| Session:', req.sessionID, '| User:', req.session.user?.username || 'N/A');
    next();
});

// Middleware para verificar autenticação em APIs
const requireAuthAPI = (req, res, next) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Não autenticado' });
    }
    next();
};

// ========== ROTAS ========== //

// Rota principal
app.get('/', (req, res) => {
    console.log('🏠 Página principal - User:', req.session.user?.username || 'Não logado');
    
    if (req.session.user) {
        return res.redirect('/dashboard');
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Login Discord
app.get('/auth/discord', (req, res) => {
    console.log('🔐 Iniciando login Discord...');
    const discordAuthURL = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.CALLBACK_URL)}&response_type=code&scope=identify`;
    res.redirect(discordAuthURL);
});

// Callback do Discord - VERSÃO SUPER SIMPLIFICADA
app.get('/auth/discord/callback', async (req, res) => {
    try {
        const { code } = req.query;
        
        console.log('🔄 Callback recebido, code:', code ? '✅' : '❌');
        
        if (!code) {
            console.log('❌ Code não recebido');
            return res.redirect('/?error=no_code');
        }

        // Trocar code por access token
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token',
            new URLSearchParams({
                client_id: process.env.DISCORD_CLIENT_ID,
                client_secret: process.env.DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: process.env.CALLBACK_URL,
                scope: 'identify'
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            }
        );

        const accessToken = tokenResponse.data.access_token;
        console.log('✅ Access token obtido');

        // Buscar dados do usuário
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        });

        const userData = userResponse.data;
        console.log('✅ Dados do usuário:', userData.username);
        
        // SALVAR USUÁRIO NA SESSÃO - FORÇAR SALVAMENTO
        req.session.user = {
            id: userData.id,
            username: userData.username,
            discriminator: userData.discriminator,
            avatar: userData.avatar
        };

        // FORÇAR SALVAMENTO DA SESSÃO
        req.session.save((err) => {
            if (err) {
                console.error('❌ Erro ao salvar sessão:', err);
                return res.redirect('/?error=session_error');
            }
            
            console.log('💾 Sessão salva com sucesso para:', userData.username);
            console.log('🔄 Redirecionando para /dashboard...');
            
            // Redirecionar para dashboard
            res.redirect('/dashboard');
        });

    } catch (error) {
        console.error('❌ Erro no callback:', error.response?.data || error.message);
        res.redirect('/?error=auth_failed');
    }
});

// Dashboard - VERIFICAÇÃO FORTE
app.get('/dashboard', (req, res) => {
    console.log('📊 Acessando dashboard...');
    console.log('   Session user:', req.session.user);
    console.log('   Session ID:', req.sessionID);
    
    if (!req.session.user) {
        console.log('❌ SEM USUÁRIO NA SESSÃO - Redirecionando para /');
        return res.redirect('/');
    }

    const userToken = tokens.get(req.session.user.id);

    console.log('✅ Renderizando dashboard para:', req.session.user.username);
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

    console.log('💾 Salvando token para:', req.session.user.username);
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
        console.log('🧹 Iniciando limpeza para:', req.session.user.username);
        
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

// Logout
app.get('/logout', (req, res) => {
    console.log('🚪 Logout:', req.session.user?.username);
    
    if (req.session.user) {
        tokens.delete(req.session.user.id);
    }
    
    req.session.destroy((err) => {
        if (err) {
            console.error('❌ Erro ao destruir sessão:', err);
        }
        res.redirect('/');
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK',
        user: req.session.user ? req.session.user.username : 'Não logado',
        sessionId: req.sessionID
    });
});

// Debug session - CRÍTICO PARA TESTE
app.get('/debug-session', (req, res) => {
    res.json({
        user: req.session.user,
        sessionID: req.sessionID,
        hasToken: req.session.user ? tokens.has(req.session.user.id) : false,
        cookies: req.headers.cookie
    });
});

// Rota de teste de sessão
app.get('/test-session', (req, res) => {
    req.session.test = 'test-value';
    req.session.save((err) => {
        if (err) {
            return res.json({ error: 'Erro ao salvar sessão', details: err.message });
        }
        res.json({ 
            message: 'Sessão testada', 
            sessionId: req.sessionID,
            testValue: req.session.test 
        });
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`🏠 Health: http://localhost:${PORT}/health`);
    console.log(`🔍 Debug: http://localhost:${PORT}/debug-session`);
    console.log(`🔐 Login: http://localhost:${PORT}/auth/discord`);
});
