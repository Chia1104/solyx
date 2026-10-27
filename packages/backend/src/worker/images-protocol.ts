import type {
  ImageLimits,
  PreparedImage,
} from "@earendil-works/pi-durable/tools";

/** What an image thread is started with: Photon's build and the one image to prepare. */
export interface ImageRequest {
  /** Photon's WebAssembly, which ships beside the backend's bundle. */
  wasm: string;
  bytes: Uint8Array;
  mimeType: string;
  limits: ImageLimits;
}

/** The image as the model takes it, `undefined` where it could not be made to, or why it failed. */
export type ImageReply =
  | { result: PreparedImage | undefined }
  | { error: string };
