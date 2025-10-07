// Sistema de Partículas
function createParticles() {
    const container = document.querySelector('.particles-container');
    const particleCount = 50;
    
    for (let i = 0; i < particleCount; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        
        // Posição aleatória
        particle.style.left = Math.random() * 100 + 'vw';
        particle.style.top = Math.random() * 100 + 'vh';
        
        // Tamanho aleatório
        const size = Math.random() * 3 + 1;
        particle.style.width = size + 'px';
        particle.style.height = size + 'px';
        
        // Duração aleatória da animação
        particle.style.animationDuration = (Math.random() * 10 + 5) + 's';
        particle.style.animationDelay = (Math.random() * 5) + 's';
        
        container.appendChild(particle);
    }
}

// Sistema de Slides
class TutorialSlider {
    constructor() {
        this.slides = document.querySelectorAll('.slide');
        this.navButtons = document.querySelectorAll('.nav-btn');
        this.currentSlide = 0;
        this.interval = null;
        
        this.init();
    }
    
    init() {
        this.startAutoSlide();
        this.addEventListeners();
    }
    
    startAutoSlide() {
        this.interval = setInterval(() => {
            this.nextSlide();
        }, 4000);
    }
    
    nextSlide() {
        this.slides[this.currentSlide].classList.remove('active');
        this.navButtons[this.currentSlide].classList.remove('active');
        
        this.currentSlide = (this.currentSlide + 1) % this.slides.length;
        
        this.slides[this.currentSlide].classList.add('active');
        this.navButtons[this.currentSlide].classList.add('active');
    }
    
    goToSlide(index) {
        clearInterval(this.interval);
        
        this.slides[this.currentSlide].classList.remove('active');
        this.navButtons[this.currentSlide].classList.remove('active');
        
        this.currentSlide = index;
        
        this.slides[this.currentSlide].classList.add('active');
        this.navButtons[this.currentSlide].classList.add('active');
        
        this.startAutoSlide();
    }
    
    addEventListeners() {
        this.navButtons.forEach((button, index) => {
            button.addEventListener('click', () => {
                this.goToSlide(index);
            });
        });
    }
}

// Funções do Dashboard
function saveToken() {
    const token = document.getElementById('discordToken').value;
    const statusDiv = document.getElementById('tokenStatus');
    
    if (!token) {
        showStatus('Por favor, insira um token válido.', 'error');
        return;
    }
    
    fetch('/save-token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ token: token })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showStatus('Token salvo com sucesso!', 'success');
        } else {
            showStatus('Erro ao salvar token: ' + data.error, 'error');
        }
    })
    .catch(error => {
        showStatus('Erro de conexão: ' + error.message, 'error');
    });
}

function clearDM() {
    const channelId = document.getElementById('channelId').value;
    const statusDiv = document.getElementById('dmStatus');
    
    if (!channelId) {
        showStatus('Por favor, insira um Channel ID válido.', 'error', 'dmStatus');
        return;
    }
    
    showStatus('Iniciando limpeza... Isso pode levar alguns minutos.', 'info', 'dmStatus');
    
    fetch('/clear-dm', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ channelId: channelId })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showStatus(data.message, 'success', 'dmStatus');
        } else {
            showStatus('Erro: ' + data.error, 'error', 'dmStatus');
        }
    })
    .catch(error => {
        showStatus('Erro de conexão: ' + error.message, 'error', 'dmStatus');
    });
}

function showStatus(message, type, elementId = 'tokenStatus') {
    const statusDiv = document.getElementById(elementId);
    statusDiv.textContent = message;
    statusDiv.className = `status-message status-${type}`;
    statusDiv.style.display = 'block';
    
    setTimeout(() => {
        statusDiv.style.display = 'none';
    }, 5000);
}

// Inicialização
document.addEventListener('DOMContentLoaded', function() {
    createParticles();
    
    if (document.querySelector('.slider')) {
        new TutorialSlider();
    }
    
    // Event Listeners para o dashboard
    const saveTokenBtn = document.getElementById('saveTokenBtn');
    const clearDmBtn = document.getElementById('clearDmBtn');
    
    if (saveTokenBtn) {
        saveTokenBtn.addEventListener('click', saveToken);
    }
    
    if (clearDmBtn) {
        clearDmBtn.addEventListener('click', clearDM);
    }
});