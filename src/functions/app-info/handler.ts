import { Handler } from "aws-lambda";
import "source-map-support/register";

import { middyfy } from "@libs/lambda";

const appInfo: Handler = async (event, _context) => {
  return {
    name: "myapp",
    version: "0.0.1",
  };
};

export const main = middyfy(appInfo);
