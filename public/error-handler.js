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
        // H3: Log full details to console; show only a safe generic message to the user
        console.error('[GlobalError]', msg, url + ':' + line + ':' + col, error);
        showError('An unexpected error occurred. Try reloading the page.');
        return false;
    };

    window.onunhandledrejection = function (event) {
        var reason = event.reason;
        // Suppress benign View Transition abort errors
        if (reason && (
            (reason.name === 'AbortError') ||
            (typeof reason.message === 'string' && (
                reason.message.indexOf('Transition was skipped') !== -1 ||
                reason.message.indexOf('Transition was aborted') !== -1
            ))
        )) {
            event.preventDefault();
            return;
        }
        // H3: Log full details to console; show only a safe generic message to the user
        console.error('[UnhandledRejection]', reason);
        showError('An unexpected error occurred. Try reloading the page.');
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
