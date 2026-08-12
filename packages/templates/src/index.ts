import type { BusinessTemplate, BusinessTemplateId } from "./types.js";
import { ecommerceTemplate } from "./ecommerce.js";
import { serviceTemplate } from "./service.js";
import { saasTemplate } from "./saas.js";
import { contentTemplate } from "./content.js";
import { localTemplate } from "./local.js";
import { physicalSpaceTemplate } from "./physicalSpace.js";

export * from "./types.js";
export * from "./handsAuth.js";
export { ecommerceTemplate, serviceTemplate, saasTemplate, contentTemplate, localTemplate, physicalSpaceTemplate };

export const allTemplates: Record<BusinessTemplateId, BusinessTemplate> = {
  ecommerce: ecommerceTemplate,
  service: serviceTemplate,
  saas: saasTemplate,
  content: contentTemplate,
  local: localTemplate,
  "physical-space": physicalSpaceTemplate,
};
