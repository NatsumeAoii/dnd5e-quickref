// Global Error Handler — loaded before main app module
// Handles uncaught errors and unhandled promise rejections
(function () {
    'use strict';

    function showError(message) {
        var el = document.getElementById('global-error-boundary');
        var txt = document.getElementById('error-text');
        if (el && txt) {
            el.classList.add('visible');
            txt.textContent = message;
        }
    }

    window.onerror = function (msg, url, line, col, error) {
        var ts = new Date().toISOString();
        showError('[' + ts + '] ' + msg + '\nSource: ' + url + ':' + line + ':' + col + '\n' + (error && error.stack ? error.stack : ''));
        return false;
    };

    window.onunhandledrejection = function (event) {
        var ts = new Date().toISOString();
        var reason = event.reason;
        var message = reason instanceof Error ? reason.message : String(reason);
        var stack = reason instanceof Error ? reason.stack : '';
        showError('[' + ts + '] Unhandled Promise Rejection: ' + message + '\n' + (stack || ''));
    };

    // #11: Wire error boundary buttons via addEventListener (no inline onclick)
    document.addEventListener('DOMContentLoaded', function initErrorBoundary() {
        var reloadBtn = document.getElementById('error-reload-btn');
        var resetBtn = document.getElementById('error-reset-btn');

        if (reloadBtn) {
            reloadBtn.addEventListener('click', function () {
                window.location.reload();
            });
        }
        if (resetBtn) {
            resetBtn.addEventListener('click', function () {
                localStorage.clear();
                sessionStorage.clear();
                window.location.reload();
            });
        }

        // #8: Switch font stylesheet from print to all (non-render-blocking load)
        var fontLink = document.getElementById('google-fonts-link');
        if (fontLink) fontLink.media = 'all';
    }, { once: true });
})();
