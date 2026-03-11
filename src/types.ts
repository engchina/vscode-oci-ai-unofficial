export type ResourceState = "RUNNING" | "STOPPED" | "STARTING" | "STOPPING" | "UNKNOWN";

export interface ComputeResource {
  id: string;
  name: string;
  lifecycleState: ResourceState | string;
  compartmentId?: string;
  region?: string;
  publicIp?: string;
  privateIp?: string;
  subnetId?: string;
  vcnId?: string;
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
  subnetId?: string;
  vcnId?: string;
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

export interface ObjectStorageBucketResource {
  name: string;
  compartmentId: string;
  namespaceName: string;
  region: string;
  storageTier?: string;
  publicAccessType?: string;
  approximateCount?: number;
  approximateSize?: number;
  createdAt?: string;
}

export interface ObjectStorageObjectResource {
  name: string;
  size?: number;
  etag?: string;
  md5?: string;
  timeCreated?: string;
  timeModified?: string;
}

export interface BastionResource {
  id: string;
  name: string;
  lifecycleState: string;
  compartmentId: string;
  region: string;
  targetVcnId?: string;
  targetSubnetId?: string;
  clientCidrBlockAllowList?: string[];
  dnsProxyStatus?: string;
}

export interface BastionSessionResource {
  id: string;
  name: string;
  lifecycleState: string;
  bastionId: string;
  targetResourceDetails?: any;
  keyDetails?: any;
  sessionTtlInSeconds?: number;
  sshMetadata?: Record<string, string>;
}

export type SpeechTranscriptionModelType = "WHISPER_MEDIUM" | "WHISPER_LARGE_V3_TURBO";

export type SpeechTranscriptionLanguageCode = "ja" | "en" | "zh";

export type SpeechProfanityFilterMode = "MASK";

export interface SpeechTranscriptionJobResource {
  id: string;
  name: string;
  compartmentId: string;
  region: string;
  lifecycleState: string;
  lifecycleDetails?: string;
  description?: string;
  percentComplete?: number;
  totalTasks?: number;
  outstandingTasks?: number;
  successfulTasks?: number;
  timeAccepted?: string;
  timeStarted?: string;
  timeFinished?: string;
  inputNamespaceName?: string;
  inputBucketName?: string;
  inputObjectNames?: string[];
  outputNamespaceName?: string;
  outputBucketName?: string;
  outputPrefix?: string;
  modelType?: SpeechTranscriptionModelType | string;
  languageCode?: SpeechTranscriptionLanguageCode | string;
  domain?: string;
  additionalTranscriptionFormats?: string[];
  isPunctuationEnabled?: boolean;
  isDiarizationEnabled?: boolean;
  numberOfSpeakers?: number;
  profanityFilterMode?: SpeechProfanityFilterMode | string;
  whisperPrompt?: string;
}

export interface SpeechTranscriptionTaskResource {
  id: string;
  name: string;
  jobId: string;
  lifecycleState: string;
  lifecycleDetails?: string;
  percentComplete?: number;
  fileSizeInBytes?: number;
  fileDurationInSeconds?: number;
  processingDurationInSeconds?: number;
  timeStarted?: string;
  timeFinished?: string;
}
