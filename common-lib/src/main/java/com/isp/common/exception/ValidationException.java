package com.isp.common.exception;

import com.isp.common.dto.ErrorDetail;

import java.util.List;

public class ValidationException extends ServiceException {
    public ValidationException(String field, String reasonCode, String message) {
        super("VALIDATION_ERROR", message, List.of(new ErrorDetail(field, reasonCode, message)));
    }

    public ValidationException(String message, List<ErrorDetail> details) {
        super("VALIDATION_ERROR", message, details);
    }
}
