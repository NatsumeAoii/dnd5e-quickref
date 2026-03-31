import { CONFIG } from '../config.js';
import type { StateManager } from '../state/StateManager.js';

export class SyncService {
    #channel: BroadcastChannel;
    #stateManager: StateManager;

    constructor(stateManager: StateManager) {
        this.#stateManager = stateManager;
        this.#channel = new BroadcastChannel('quickref_sync');
        this.#channel.onmessage = (event: MessageEvent) => this.#handleMessage(event.data);
        // (J) Log structured-clone deserialization failures instead of silently swallowing
        this.#channel.onmessageerror = () => console.warn('SyncService: received undeserializable message');
    }

    broadcast(type: string, payload: unknown): void {
        this.#channel.postMessage({ type, payload, version: CONFIG.APP_VERSION });
    }

    #handleMessage(data: unknown): void {
        if (!data || typeof data !== 'object') return;
        const { type, payload, version } = data as { type: string; payload: unknown; version?: string };
        if (typeof type !== 'string') return;
        if (version && version !== CONFIG.APP_VERSION) return; // Ignore messages from incompatible versions
        this.#stateManager.publish('externalStateChange', { type, payload });
    }
}
