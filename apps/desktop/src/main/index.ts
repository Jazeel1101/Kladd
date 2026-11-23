import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Layer } from "effect";
import { MainLive } from "./MainLive";

NodeRuntime.runMain(Layer.launch(MainLive));
