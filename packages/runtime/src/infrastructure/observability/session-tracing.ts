import type { Sessions } from "../../application/sessions/operations.ts";
import type { Telemetry } from "../../shared/application/telemetry.ts";

/** Commands get operational spans; request text, arguments and attachment names never do. */
export function traceSessions(sessions: Sessions, telemetry: Telemetry) {
  return {
    chooseModel: (...args: Parameters<Sessions["chooseModel"]>) =>
      sessions.chooseModel(...args),
    submit: (...args: Parameters<Sessions["submit"]>) =>
      telemetry.run(
        "session.submit",
        { source: args[0].source },
        async (annotate) => {
          const receipt = await sessions.submit(...args);
          annotate({ "session.id": receipt.sessionId, "turn.id": receipt.id });
          return receipt;
        },
      ),
    submitLegacy: (...args: Parameters<Sessions["submitLegacy"]>) =>
      telemetry.run(
        "session.submit",
        { source: args[0].source },
        async (annotate) => {
          const receipt = await sessions.submitLegacy(...args);
          annotate({ "session.id": receipt.sessionId, "turn.id": receipt.id });
          return receipt;
        },
      ),
    decide: (...args: Parameters<Sessions["decide"]>) =>
      telemetry.run(
        "approval.decide",
        { source: args[0].source },
        async (annotate) => {
          const status = await sessions.decide(...args);
          annotate({ "approval.id": args[1] });
          return status;
        },
      ),
    copy: (...args: Parameters<Sessions["copy"]>) =>
      telemetry.run(
        "file.submit",
        { source: args[0].source },
        async (annotate) => {
          const id = await sessions.copy(...args);
          annotate({ "approval.id": id });
          return id;
        },
      ),
    decideFile: (...args: Parameters<Sessions["decideFile"]>) =>
      telemetry.run(
        "file.decide",
        { source: args[0].source },
        async (annotate) => {
          const status = await sessions.decideFile(...args);
          annotate({ "approval.id": args[1] });
          return status;
        },
      ),
  };
}
