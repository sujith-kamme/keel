// Registers AG Grid once for every console grid. Imported for its side effect by client components.
// Without a licence key the Enterprise features still work, with a trial watermark.
import { ModuleRegistry } from "ag-grid-community";
import { AllEnterpriseModule, LicenseManager } from "ag-grid-enterprise";

const key = process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY;
if (key) LicenseManager.setLicenseKey(key);
ModuleRegistry.registerModules([AllEnterpriseModule]);
