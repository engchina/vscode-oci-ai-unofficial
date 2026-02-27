export type ResourceState = "RUNNING" | "STOPPED" | "STARTING" | "STOPPING" | "UNKNOWN";

export interface ComputeResource {
  id: string;
  name: string;
  lifecycleState: ResourceState | string;
  compartmentId?: string;
  region?: string;
  publicIp?: string;
  privateIp?: string;
}

export interface DbSystemResource {
  id: string;
  name: string;
  lifecycleState: ResourceState | string;
  nodeLifecycleState?: string;
  compartmentId?: string;
  region?: string;
  publicIp?: string;
  privateIp?: string;
  connectString?: string;
}

export interface AdbResource {
  id: string;
  name: string;
  lifecycleState: ResourceState | string;
  compartmentId?: string;
  region?: string;
}

export interface VcnResource {
  id: string;
  name: string;
  lifecycleState: string;
  compartmentId: string;
  region: string;
  cidrBlocks: string[];
}

export interface SecurityRule {
  isStateless: boolean;
  protocol: string;
  source?: string;
  destination?: string;
  description?: string;
  tcpOptions?: {
    destinationPortRange?: { min: number; max: number };
    sourcePortRange?: { min: number; max: number };
  };
  udpOptions?: {
    destinationPortRange?: { min: number; max: number };
    sourcePortRange?: { min: number; max: number };
  };
  icmpOptions?: {
    type: number;
    code?: number;
  };
}

export interface SecurityListResource {
  id: string;
  name: string;
  lifecycleState: string;
  compartmentId: string;
  vcnId: string;
  region: string;
  ingressSecurityRules: SecurityRule[];
  egressSecurityRules: SecurityRule[];
}
