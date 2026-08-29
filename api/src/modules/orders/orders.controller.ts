import { Controller, Get } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
@ApiTags("orders")
@Controller("orders")
export class OrdersController { @Get() findAll() { return { data: [] }; } }
