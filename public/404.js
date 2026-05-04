(function () {
    'use strict';

    function getAppBase() {
        if (document.currentScript && document.currentScript.src) {
            var scriptUrl = new URL(document.currentScript.src, window.location.href);
            return scriptUrl.pathname.replace(/404\.js$/i, '');
        }
        var segments = window.location.pathname.split('/').filter(Boolean);
        if (segments.length === 0) return '/';
        return '/' + segments[0] + '/';
    }

    function readStorage(key) {
        try {
            return window.localStorage.getItem(key);
        } catch {
            return null;
        }
    }

    var appBase = getAppBase();
    var homeLink = document.getElementById('home-link');
    if (homeLink) homeLink.setAttribute('href', appBase);

    var theme = readStorage('theme') || 'original';
    var mode = readStorage('mode') === 'true' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.mode = mode;

    var themeSheet = document.getElementById('theme-stylesheet');
    if (theme !== 'original' && themeSheet && /^[a-z0-9_-]{1,64}$/i.test(theme)) {
        themeSheet.setAttribute('href', appBase + 'themes/' + theme + '.css');
    }

    if (window.location.hash) {
        var notice = document.getElementById('redirect-notice');
        if (notice) notice.classList.remove('hidden');
        var safe = /^#[\w\-.,~%!*'();:@&=+$/?]*$/;
        if (safe.test(window.location.hash)) {
            window.setTimeout(function () {
                window.location.replace(appBase + window.location.hash);
            }, 500);
        }
    }
})();
