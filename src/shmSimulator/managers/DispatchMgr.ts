import { TransferMgr, VehicleCommand, IVehicleDataArray } from "@/common/vehicle/logic/TransferMgr";
import type { Edge } from "@/types/edge";

export class DispatchMgr {
  private readonly transferMgr: TransferMgr;
  private vehicleDataArray?: IVehicleDataArray;
  private edgeArray?: Edge[];
  private edgeNameToIndex?: Map<string, number>;

  constructor(transferMgr: TransferMgr) {
    this.transferMgr = transferMgr;
  }

  /**
   * Set vehicle data array for memory access
   */
  public setVehicleDataArray(vehicleDataArray: IVehicleDataArray): void {
    this.vehicleDataArray = vehicleDataArray;
  }

  /**
   * Set edge data for command validation
   */
  public setEdgeData(edgeArray: Edge[], edgeNameToIndex: Map<string, number>): void {
    this.edgeArray = edgeArray;
    this.edgeNameToIndex = edgeNameToIndex;
  }

  /**
   * Parse vehId from string or number format
   * Examples: "VEH00001" -> 1, "VEH00042" -> 42, 5 -> 5
   */
  private parseVehId(vehId: string | number | undefined | null): number {
    if (vehId === undefined || vehId === null) {
      return 0; // Default to vehicle 0
    }

    if (typeof vehId === "number") {
      return vehId;
    }

    // Parse string format like "VEH00001" -> 1
    const regex = /\d+/;
    const match = regex.exec(vehId);
    if (match) {
      return Number.parseInt(match[0], 10);
    }

    console.warn(`[DispatchMgr] Invalid vehId format: ${vehId}, defaulting to 0`);
    return 0;
  }

  /**
   * Dispatch a command to a vehicle
   */
  public dispatch(command: VehicleCommand & { vehId?: number | string }): void {
    console.log("[DispatchMgr] Dispatching command:", command);

    const vehId = this.parseVehId(command.vehId);
    console.log(`[DispatchMgr] Parsed vehId: ${vehId}`);

    this.assignToVehicle(vehId, command);
  }

  /**
   * Assign the command to the specific vehicle via TransferMgr
   */
  private assignToVehicle(vehId: number, command: VehicleCommand): void {
    console.log(`[DispatchMgr] Assigning to Vehicle ${vehId}`);
    this.transferMgr.assignCommand(
      vehId,
      command,
      this.vehicleDataArray,
      this.edgeArray,
      this.edgeNameToIndex
    );
  }

  /**
   * Dispose all references to allow garbage collection
   */
  dispose(): void {
    this.vehicleDataArray = undefined;
    this.edgeArray = undefined;
    this.edgeNameToIndex = undefined;
  }
}
