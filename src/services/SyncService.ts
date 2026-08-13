import { CONFIG } from '../config.js';
import type { StateManager } from '../state/StateManager.js';

export class SyncService {
    #channel: BroadcastChannel | null = null;
    #stateManager: StateManager;
    #senderId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    #lastMessageAt = 0;

    constructor(stateManager: StateManager) {
        this.#stateManager = stateManager;
        if (typeof BroadcastChannel !== 'function') return;
        this.#channel = new BroadcastChannel('quickref_sync');
        this.#channel.onmessage = (event: MessageEvent) => this.#handleMessage(event.data);
        this.#channel.onmessageerror = () => console.warn('SyncService: received undeserializable message');
    }

    broadcast(type: string, payload: unknown): void {
        if (!this.#channel) return;
        try {
            this.#channel.postMessage({ type, payload, version: CONFIG.APP_VERSION, senderId: this.#senderId, messageId: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`, timestamp: Date.now() });
        } catch (e) {
            console.warn('SyncService: failed to broadcast state change', e);
        }
    }

    destroy(): void {
        if (!this.#channel) return;
        this.#channel.onmessage = null;
        this.#channel.onmessageerror = null;
        this.#channel.close();
        this.#channel = null;
    }

    #handleMessage(data: unknown): void {
        if (!data || typeof data !== 'object') return;
        const { type, payload, version, senderId, messageId, timestamp } = data as { type?: unknown; payload?: unknown; version?: unknown; senderId?: unknown; messageId?: unknown; timestamp?: unknown };
        if (typeof type !== 'string') return;
        if (!['SETTING_CHANGE', 'FAVORITE_TOGGLE', 'NOTE_UPDATE'].includes(type)) return;
        if (version !== CONFIG.APP_VERSION || typeof senderId !== 'string' || senderId === this.#senderId || typeof messageId !== 'string' || typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp < this.#lastMessageAt) return;
        if (!this.#isValidPayload(type, payload)) return;
        this.#lastMessageAt = timestamp;
        this.#stateManager.publish('externalStateChange', { type, payload });
    }

    #isValidPayload(type: string, payload: unknown): boolean {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
        const value = payload as Record<string, unknown>;
        if (type === 'SETTING_CHANGE') return typeof value.key === 'string' && (typeof value.value === 'boolean' || typeof value.value === 'string');
        if (type === 'FAVORITE_TOGGLE') return typeof value.id === 'string' && value.id.length < 300;
        return typeof value.id === 'string' && value.id.length < 300 && typeof value.text === 'string' && value.text.length <= CONFIG.IMPORT_LIMITS.MAX_NOTE_SIZE_BYTES;
    }
}
