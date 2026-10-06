import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

export const isNative = Capacitor.isNativePlatform();

export async function initCapacitorPlatform() {
  if (!isNative) return;

  try {
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#0f172a' });
  } catch (err) {
    console.warn('StatusBar configuration skipped:', err);
  }

  // Handle Android hardware back button
  CapApp.addListener('backButton', ({ canGoBack }) => {
    // 1. If any modal is open, attempt to close the foremost modal
    const openModals = document.querySelectorAll('.modal-overlay, .receipt-modal-backdrop, .scanner-modal-backdrop, dialog[open]');
    if (openModals.length > 0) {
      const lastModal = openModals[openModals.length - 1];
      const closeBtn = lastModal.querySelector('button[aria-label="Close"], button.btn-close, button.modal-close-btn') as HTMLButtonElement | null;
      if (closeBtn) {
        closeBtn.click();
        return;
      }
    }

    // 2. If browser history allows going back and we're not on dashboard
    const currentPath = window.location.pathname;
    if (canGoBack && currentPath !== '/' && currentPath !== '/pos') {
      window.history.back();
      return;
    }

    // 3. At root page: exit app
    CapApp.exitApp();
  });
}

export async function triggerHaptic(type: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' = 'light') {
  if (!isNative) return;
  try {
    if (type === 'success') {
      await Haptics.notification({ type: NotificationType.Success });
    } else if (type === 'warning') {
      await Haptics.notification({ type: NotificationType.Warning });
    } else if (type === 'error') {
      await Haptics.notification({ type: NotificationType.Error });
    } else if (type === 'heavy') {
      await Haptics.impact({ style: ImpactStyle.Heavy });
    } else if (type === 'medium') {
      await Haptics.impact({ style: ImpactStyle.Medium });
    } else {
      await Haptics.impact({ style: ImpactStyle.Light });
    }
  } catch {
    // Haptics unavailable on web or non-supported device
  }
}
