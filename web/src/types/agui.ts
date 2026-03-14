export interface AguiEventBase {
  type: string;
}

export interface TextMessageContentEvent extends AguiEventBase {
  type: "TEXT_MESSAGE_CONTENT";
  delta?: string;
  msg?: string;
}

export interface RunFinishedEvent extends AguiEventBase {
  type: "RUN_FINISHED";
}

export interface TextMessageStartEvent extends AguiEventBase {
  type: "TEXT_MESSAGE_START";
}

export interface TextMessageEndEvent extends AguiEventBase {
  type: "TEXT_MESSAGE_END";
}

export interface ErrorEvent extends AguiEventBase {
  type: "ERROR" | "RUN_ERROR";
  message?: string;
  error?: string;
}

export type AguiEvent =
  | TextMessageStartEvent
  | TextMessageContentEvent
  | TextMessageEndEvent
  | RunFinishedEvent
  | ErrorEvent
  | AguiEventBase;
