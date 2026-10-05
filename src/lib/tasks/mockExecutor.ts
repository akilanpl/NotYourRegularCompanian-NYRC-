import type {
  ActionExecutor,
  ActionId,
  ActionResult,
  CompanionAction,
} from "./action";
import { actionFailure, actionSuccess } from "./action";

export class MockActionExecutor implements ActionExecutor {
  readonly executed: CompanionAction[] = [];

  constructor(
    private readonly supportedActions: readonly ActionId[] = [],
    private readonly result: ActionResult = actionSuccess({ accepted: true }),
  ) {}

  canExecute(action: CompanionAction): boolean {
    return this.supportedActions.includes(action.id);
  }

  async execute(action: CompanionAction): Promise<ActionResult> {
    if (!this.canExecute(action)) {
      return actionFailure(
        "unsupported_action",
        `No mock implementation for ${action.id}`,
      );
    }
    this.executed.push(action);
    return this.result;
  }
}
