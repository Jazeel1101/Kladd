import { KladdRpcs } from "@kladd/contract";
import { layerProtocol } from "@kladd/rpc-electron/client";
import { AtomRpc } from "effect/reactivity";

/**
 * The one RPC client for the UI. Build atoms from it with KladdClient.query / KladdClient.mutation
 * in the feature folder (see src/recording/atoms.ts). Never call the main process another way.
 */
export class KladdClient extends AtomRpc.Service<KladdClient>()("kladd/ui/KladdClient", {
  group: KladdRpcs,
  protocol: layerProtocol,
}) {}
