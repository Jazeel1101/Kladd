import { KladdClient } from "../rpc";

/** Reactivity key shared by queries and the mutations that change them. */
const recordingKey = ["recording"];

export const activeRecordingAtom = KladdClient.query("GetActiveRecording", undefined, {
  reactivityKeys: recordingKey,
});

export const startRecordingAtom = KladdClient.mutation("StartRecording");

export const startRecordingArgs = { payload: undefined, reactivityKeys: recordingKey };
