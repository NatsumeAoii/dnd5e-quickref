import { CONFIG } from '../config.js';
import type { StateManager } from '../state/StateManager.js';

export class SyncService {
    #channel: BroadcastChannel | null = null;
    #stateManager: StateManager;

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
            this.#channel.postMessage({ type, payload, version: CONFIG.APP_VERSION });
        } catch (e) {
            console.warn('SyncService: failed to broadcast state change', e);
        }
    }

    #handleMessage(data: unknown): void {
        if (!data || typeof data !== 'object') return;
        const { type, payload, version } = data as { type?: unknown; payload?: unknown; version?: unknown };
        if (typeof type !== 'string') return;
        if (typeof version === 'string' && version !== CONFIG.APP_VERSION) return;
        this.#stateManager.publish('externalStateChange', { type, payload });
    }
}
