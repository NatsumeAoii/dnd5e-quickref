import type { StateManager } from '../state/StateManager.js';

export class SyncService {
    #channel: BroadcastChannel;
    #stateManager: StateManager;

    constructor(stateManager: StateManager) {
        this.#stateManager = stateManager;
        this.#channel = new BroadcastChannel('quickref_sync');
        this.#channel.onmessage = (event: MessageEvent) => this.#handleMessage(event.data);
    }

    broadcast(type: string, payload: unknown): void {
        this.#channel.postMessage({ type, payload });
    }

    #handleMessage({ type, payload }: { type: string; payload: unknown }): void {
        this.#stateManager.publish('externalStateChange', { type, payload });
    }
}
