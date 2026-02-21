export type ResourceState = "RUNNING" | "STOPPED" | "STARTING" | "STOPPING" | "UNKNOWN";

export interface ComputeResource {
  id: string;
  name: string;
  lifecycleState: ResourceState | string;
  publicIp?: string;
  privateIp?: string;
}

export interface AdbResource {
  id: string;
  name: string;
  lifecycleState: ResourceState | string;
}
