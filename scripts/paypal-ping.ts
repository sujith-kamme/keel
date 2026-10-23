// Day-1 check: sandbox credentials work and Keel can create and read an order.
import { PayPalClient, configFromEnv } from "@keel/paypal";

const paypal = new PayPalClient(configFromEnv());
const order = await paypal.createOrder({ value: "45.00", currency: "USD" });
const fetched = await paypal.getOrder(order.id);
console.log(`PayPal sandbox OK: order ${fetched.id} is ${fetched.status}`);
