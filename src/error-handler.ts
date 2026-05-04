const showError = (message: string): void => {
    const el = document.getElementById('global-error-boundary');
    const txt = document.getElementById('error-text');
    if (el && txt) {
        el.classList.add('visible');
        txt.textContent = message;
    }
};

window.onerror = (message, source, line, column, error): boolean => {
    const timestamp = new Date().toISOString();
    console.error('[GlobalError]', { message, source, line, column, error });
    showError(`[${timestamp}] Unexpected app error. Reload the page to try again.`);
    return false;
};

window.onunhandledrejection = (event): void => {
    const { reason } = event;
    if (reason && (
        reason.name === 'AbortError' ||
        (typeof reason.message === 'string' && (
            reason.message.includes('Transition was skipped') ||
            reason.message.includes('Transition was aborted')
        ))
    )) {
        event.preventDefault();
        return;
    }

    const timestamp = new Date().toISOString();
    const message = reason instanceof Error ? reason.message : String(reason);
    console.error('[UnhandledRejection]', message, reason);
    showError(`[${timestamp}] Unexpected app error. Reload the page to try again.`);
};

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('error-reload-btn')?.addEventListener('click', () => {
        window.location.reload();
    });

    document.getElementById('error-reset-btn')?.addEventListener('click', () => {
        if (!window.confirm('This clears local settings, favorites, and session state for this site. Continue?')) return;
        localStorage.clear();
        sessionStorage.clear();
        window.location.reload();
    });

    const fontLink = document.getElementById('google-fonts-link') as HTMLLinkElement | null;
    if (fontLink) fontLink.media = 'all';
}, { once: true });
