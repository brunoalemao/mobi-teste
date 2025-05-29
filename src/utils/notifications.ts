// Verifica se o dispositivo suporta notificações
export const checkNotificationSupport = () => {
  return 'Notification' in window;
};

// Verifica se é um dispositivo móvel
export const isMobileDevice = () => {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

// Solicita permissão para notificações
export const requestNotificationPermission = async () => {
  if (!checkNotificationSupport()) {
    console.log('Este dispositivo não suporta notificações');
    return false;
  }

  try {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  } catch (error) {
    console.error('Erro ao solicitar permissão de notificação:', error);
    return false;
  }
};

// Envia uma notificação
export const sendNotification = (title: string, options: NotificationOptions = {}) => {
  if (!checkNotificationSupport()) {
    console.log('Este dispositivo não suporta notificações');
    return;
  }

  if (Notification.permission !== 'granted') {
    console.log('Permissão para notificações não concedida');
    return;
  }

  try {
    const notification = new Notification(title, {
      icon: '/logo.png', // Adicione o caminho do seu ícone
      badge: '/logo.png', // Ícone para dispositivos móveis
      vibrate: [200, 100, 200], // Padrão de vibração
      ...options
    });

    notification.onclick = function() {
      window.focus();
      notification.close();
    };

    return notification;
  } catch (error) {
    console.error('Erro ao enviar notificação:', error);
  }
}; 