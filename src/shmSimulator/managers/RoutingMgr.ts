import { DispatchMgr } from "./DispatchMgr";

export class RoutingMgr {
  private readonly dispatchMgr: DispatchMgr;

  constructor(dispatchMgr: DispatchMgr) {
    this.dispatchMgr = dispatchMgr;
  }

  /**
   * Receive a message from the Engine (external source)
   * The message is expected to be a raw command object
   */
  public receiveMessage(payload: any): void {
    console.log("[RoutingMgr] Received payload:", payload);
    
    // In the future, this might route to different managers based on payload type
    // For now, assume it's a command for a vehicle and route to DispatchMgr
    this.routeToDispatch(payload);
  }

  /**
   * Route command to DispatchMgr
   */
  private routeToDispatch(payload: any): void {
    console.log("[RoutingMgr] Routing to DispatchMgr");
    this.dispatchMgr.dispatch(payload);
  }
}
