/**
 * Function which periodically polls the OSU class database, and then sends a text message if
 * it finds a spot open in a class of interest.
 *
 * Uses self-modification of environment varibles, self-modification of triggers, and
 * someone elses REST api.
 */

import * as AWS from "aws-sdk";
import { Context, ScheduledHandler, ScheduledEvent } from "aws-lambda";
import { FunctionConfiguration } from "aws-sdk/clients/lambda";

/** the key in process.env to pay atention to */
const ENV_KEYS = ["classData", "eventName", "phone"];

/** interface specifying the types of the decoded CRN and phone number data */
interface IClassNumber {
  crn: string;
  number: string;
}

/**
 * de-encode stored class CRNs and phone numbers
 * @param env The encoded enviroment string in format of "CRN,number,CRN,number, etc."
 */
function decodeCRNs(env: string): IClassNumber[] {
  // split string csv style
  const split = env.split(",");
  const ret: IClassNumber[] = [];
  // add every other element as an object
  for (let i = 0, len = split.length; i < len; i += 2) if (split[i]) ret.push({
    crn: split[i],
    number: split[i + 1],
  });
  return ret;
}

/**
 * re-encode stored class CRNs and phone numbers
 * @returns the encoded CRN string
 */
function encodeCRNs(obj: IClassNumber[]): string {
  return obj.map((o) => `${o.crn},${o.number}`).join(",");
}

/** disable the cloudwatch event triggering this function periodically */
function disableTrigger(): Promise<{}> {
  // initialize API
  const CloudWatch = new AWS.CloudWatchEvents();
  // disable the rule
  return CloudWatch.disableRule({
    Name: process.env.eventName,
  }).promise();
}

/** enable the cloudwatch event to trigger this function */
function enableTrigger(): Promise<{}> {
  // initialize the API
  const CloudWatch = new AWS.CloudWatchEvents();
  // enable the rule
  return CloudWatch.enableRule({
    Name: process.env.eventName,
  }).promise();
}

/**
 * Update the enviroment varibles of this function
 * @param updateProps The object of things to update (values must be strings)
 * @param fnArn The name of the function (can be found in context.invokedFunctionArn)
 */
function updateEnv(updateProps: { [key: string]: string }, fnArn: string): Promise<FunctionConfiguration> {
  // only process the keys we need to care about
  // otherwise AWS gets angry
  const Variables = {};
  for (let i = 0, len = ENV_KEYS.length; i < len; i++) {
    Variables[ENV_KEYS[i]] = (updateProps[ENV_KEYS[i]] !== undefined ? updateProps[ENV_KEYS[i]] : process.env[ENV_KEYS[i]]);
  }
  // initialize lambda API
  const Lambda = new AWS.Lambda();
  // send it away!
  return Lambda.updateFunctionConfiguration({
    Environment: {
      Variables,
    },
    FunctionName: fnArn,
  }).promise();
}

/**
 * Send a text using AWS SNS!
 * @param phoneNumber The phone number to send to (e.g. +15556667777)
 * @param message The text message
 */
function sendText(phoneNumber: string, message: string): Promise<{}> {
  // initialize SNS client
  const SNS = new AWS.SNS();
  // send the text!
  return SNS.publish({
    Message: message,
    PhoneNumber: phoneNumber,
  }).promise();
}

/**
 * The main function handler for this project.
 */
export const pokeClassDetect: ScheduledHandler = async (event: ScheduledEvent, ctx: Context): Promise<any> => {
  // decode our CRNs to check
  const crnData = decodeCRNs(process.env.classData);
  // if it's an emptey array, stop trigger and return.
  if (crnData.length === 0) return disableTrigger();
  const promiseRay: Array<Promise<any>> = [];
  // start trigger if we are triggered by anything else but the scheduled event
  if (event["detail-type"] !== "Scheduled Event") promiseRay.push(enableTrigger());
  // fetch the API, check it, and if there's a spot text the number and delete the CRN element
  promiseRay.concat(crnData.map((d) => fetch()))

  return Promise.all(promiseRay);
};
