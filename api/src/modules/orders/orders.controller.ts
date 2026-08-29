import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard";
import { CreateOrderDto } from "./dto/create-order.dto";
import { OrdersService } from "./orders.service";
import { RejectOrderDto } from "./dto/reject-order.dto";
@ApiTags("orders")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("orders")
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}
  @Get() findAll(@Req() request: AuthenticatedRequest, @Query("scope") scope?: string) { return this.orders.list(request.auth.sub, scope === "provider" ? "provider" : "client"); }
  @Post() create(@Req() request: AuthenticatedRequest, @Body() input: CreateOrderDto) { return this.orders.create(request.auth.sub, input); }
  @Post(":id/accept") accept(@Req() request: AuthenticatedRequest, @Param("id") id: string) { return this.orders.accept(request.auth.sub, id); }
  @Post(":id/reject") reject(@Req() request: AuthenticatedRequest, @Param("id") id: string, @Body() input: RejectOrderDto) { return this.orders.reject(request.auth.sub, id, input.reason); }
}
