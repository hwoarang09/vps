import { TransferMgr } from "@/common/vehicle/logic/TransferMgr";

export class DispatchMgr {
  private readonly transferMgr: TransferMgr;

  constructor(transferMgr: TransferMgr) {
    this.transferMgr = transferMgr;
  }

  /**
   * Dispatch a command to a vehicle
   */
  public dispatch(command: any): void {
    console.log("[DispatchMgr] Dispatching command:", command);

    let vehId = command.vehId;

    // simplistic dispatch logic: if vehId is not provided, pick 0
    if (vehId === undefined || vehId === null) {
      console.log("[DispatchMgr] No vehId specified, defaulting to Veh 0 (Mock Logic)");
      vehId = 0;
    }

    this.assignToVehicle(vehId, command);
  }

  /**
   * Assign the command to the specific vehicle via TransferMgr
   */
  private assignToVehicle(vehId: number, command: any): void {
    console.log(`[DispatchMgr] Assigning to Vehicle ${vehId}`);
    this.transferMgr.assignCommand(vehId, command);
  }
}
