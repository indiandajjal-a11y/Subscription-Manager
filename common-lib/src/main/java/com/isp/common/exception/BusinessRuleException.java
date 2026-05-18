package com.isp.common.exception;

import com.isp.common.dto.ErrorDetail;

import java.util.List;

public class BusinessRuleException extends ServiceException {
    public BusinessRuleException(String reasonCode, String message) {
        super("BUSINESS_RULE_VIOLATION", message, List.of(new ErrorDetail(null, reasonCode, message)));
    }
}
