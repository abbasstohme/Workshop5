import {launchNodes} from "./nodes/launchNodes";
import {Value} from "./types";

export async function launchNetwork(
  N: number,
  F: number,
  initialValues: Value[],
  faultyList: boolean[]
) {

  return await launchNodes(N, F, initialValues, faultyList);
}