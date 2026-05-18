package com.isp.common.exception;

import com.isp.common.dto.ErrorDetail;

import java.util.List;

public class CartExpiredException extends ServiceException {
    public CartExpiredException(String message) {
        super("CART_EXPIRED", message, List.of(new ErrorDetail("cartId", "CART_EXPIRED", message)));
    }
}
