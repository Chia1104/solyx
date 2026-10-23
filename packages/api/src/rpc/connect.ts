/**
 * What a window posts one end of its channel with, which the preload forwards to the main process
 * on the IPC channel of the same name; the main process serves every procedure on that end.
 */
export const RPC_CONNECT = "rpc:connect";
